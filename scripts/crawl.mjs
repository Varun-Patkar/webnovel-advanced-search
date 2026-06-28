/**
 * crawl.mjs
 * -----------------------------------------------------------------------------
 * Manually-triggered snapshot crawler for WebNovel.
 *
 * Flow:
 *   1. Launch a real Chromium via Playwright and load www.webnovel.com. A real
 *      browser passes Cloudflare and is issued a `_csrfToken` cookie.
 *   2. Read the token, then call the documented search endpoints *same-origin*
 *      (see scripts/webnovel-api.mjs for why that matters).
 *   3. For every category type, pull the tag catalogue, then crawl a bounded
 *      number of result pages per tag (across the configured audience pools)
 *      and de-duplicate books by id.
 *   4. Write compact JSON snapshots into the output directory. The static
 *      GitHub Pages site searches these files entirely client-side.
 *
 * This script is invoked by `npm run crawl` (locally or in CI). It never runs
 * on a schedule — only when a human triggers it.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

import { config, CATEGORY_LABELS } from './config.mjs';
import {
  getSearchList,
  getTagList,
  readCsrfToken,
  sleep,
} from './webnovel-api.mjs';

/**
 * Normalise a raw tag catalogue into the compact shape the UI consumes and a
 * flat id→name map for convenience.
 * @param {number} categoryType
 * @param {any[]} items  Raw `data.items` from get-tag-list.
 * @returns {{categoryType:number, generatedAt:string, groups:any[], tagMap:Record<string,string>}}
 */
function normaliseTags(categoryType, items) {
  const tagMap = {};
  const groups = items.map((group) => ({
    id: group.id,
    name: group.name,
    total: group.totalCount,
    tags: (group.tagInfos ?? []).map((tag) => {
      tagMap[tag.id] = (tag.tagName || '').toLowerCase();
      return { id: tag.id, name: (tag.tagName || '').toLowerCase() };
    }),
  }));
  return {
    categoryType,
    generatedAt: new Date().toISOString(),
    groups,
    tagMap,
  };
}

/**
 * Reduce a raw book object to the compact, index-friendly record. Short keys
 * keep the generated JSON small because it ships to every visitor.
 * @param {any} book  Raw entry from get-search-list `bookInfos`.
 * @param {number} categoryType
 * @returns {object}
 */
function compactBook(book, categoryType) {
  return {
    id: String(book.bookId),
    n: book.bookName,
    a: book.authorName,
    c: book.categoryName,
    ct: categoryType,
    s: book.totalScore ?? 0,
    ch: book.chapterNum ?? 0,
    v: book.pvNum ?? 0,
    col: book.collectionNum ?? 0,
    mtl: Boolean(book.mtl),
    cu: book.coverUpdateTime ?? 0,
    t: (book.tagInfos ?? []).map((tag) => tag.id),
    d: (book.description ?? '').slice(0, config.descriptionLimit),
  };
}

/**
 * Crawl all bounded result pages for a single tag across the configured
 * audience pools, merging discovered books into `bookMap`.
 * @param {import('playwright').Page} page
 * @param {string} token
 * @param {number} categoryType
 * @param {number} tagId
 * @param {Map<string, object>} bookMap  Accumulator keyed by book id.
 * @param {{maxRetries:number, delayMs:number}} opts
 * @returns {Promise<number>}  How many genuinely-new books this tag contributed.
 */
async function crawlTag(page, token, categoryType, tagId, bookMap, opts) {
  // Count this tag's own insertions rather than diffing bookMap.size before/after
  // — under the concurrency pool other workers mutate the shared map between a
  // before/after read, which would mis-attribute their additions to this tag.
  let added = 0;
  for (const sex of config.sexes) {
    for (let pageIndex = 1; pageIndex <= config.maxPagesPerTag; pageIndex += 1) {
      const { books, last } = await getSearchList(
        page,
        token,
        { sex, categoryType, tagId, pageIndex, orderBy: config.orderBy },
        opts,
      );
      for (const raw of books) {
        // Keep only substantial, long-running stories. WebNovel's server-side
        // chapter filter is too coarse (300/1000 buckets), so enforce the
        // finer threshold here using each book's reported chapter count.
        if ((raw.chapterNum ?? 0) < config.minChapters) continue;
        const id = String(raw.bookId);
        if (!bookMap.has(id)) {
          bookMap.set(id, compactBook(raw, categoryType));
          added += 1;
        }
      }
      await sleep(config.delayMs);
      if (last || books.length === 0) break;
    }
  }
  return added;
}

/**
 * Run an async worker over `items` with a bounded number of concurrent tasks.
 * Because Node is single-threaded, shared accumulators (e.g. the book map)
 * mutated synchronously after each await are race-free.
 * @template T
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item:T, index:number)=>Promise<void>} worker
 * @returns {Promise<void>}
 */
async function runPool(items, concurrency, worker) {
  let next = 0;
  async function runner() {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  }
  const size = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: size }, () => runner()));
}

/**
 * Crawl one category type end-to-end: catalogue + book index.
 * @param {import('playwright').Page} page
 * @param {string} token
 * @param {number} categoryType
 * @param {{maxRetries:number, delayMs:number}} opts
 * @returns {Promise<{tags:object, books:object[]}>}
 */
async function crawlCategory(page, token, categoryType, opts) {
  const label = CATEGORY_LABELS[categoryType] ?? `type${categoryType}`;
  console.log(`\n=== Crawling ${label} (categoryType=${categoryType}) ===`);

  const rawTags = await getTagList(page, token, categoryType, opts);
  const tags = normaliseTags(categoryType, rawTags);
  const allTags = tags.groups.flatMap((g) => g.tags);
  const limit = config.maxTagsPerCategory > 0
    ? Math.min(config.maxTagsPerCategory, allTags.length)
    : allTags.length;
  console.log(`  ${allTags.length} tags discovered; crawling ${limit}.`);

  const bookMap = new Map();
  let done = 0;
  // Crawl tags through a concurrency pool so the network latency of many
  // requests overlaps instead of stacking up sequentially.
  await runPool(allTags.slice(0, limit), config.concurrency, async (tag) => {
    const added = await crawlTag(page, token, categoryType, tag.id, bookMap, opts);
    done += 1;
    console.log(
      `  [${done}/${limit}] #${tag.name} … +${added} new (total ${bookMap.size})`,
    );
  });

  return { tags, books: [...bookMap.values()] };
}

/**
 * Write a JSON file, pretty-printed for readable diffs in commits.
 * @param {string} dir
 * @param {string} name
 * @param {unknown} payload
 */
async function writeJson(dir, name, payload) {
  const file = join(dir, name);
  await writeFile(file, `${JSON.stringify(payload, null, 0)}\n`, 'utf8');
  console.log(`  wrote ${file}`);
}

/** Chromium launch flags that reduce automation fingerprinting. */
const STEALTH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-sandbox',
  '--disable-infobars',
];

/**
 * Launch a persistent browser context that is hard for Cloudflare to flag.
 *
 * Strategy:
 *   - Prefer the real installed Google Chrome channel (bundled Chromium loops
 *     on Cloudflare's managed challenge).
 *   - Reuse a persistent profile so `cf_clearance` survives across runs.
 *   - Mask `navigator.webdriver` before any page script runs.
 * Falls back to bundled Chromium if the Chrome channel is unavailable.
 *
 * @returns {Promise<{context:import('playwright').BrowserContext, page:import('playwright').Page}>}
 */
async function launchStealthContext() {
  const launchOpts = {
    headless: config.headless,
    args: STEALTH_ARGS,
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-US',
  };

  let context;
  if (config.browserChannel) {
    try {
      console.log(`Launching ${config.browserChannel} (persistent, headless=${config.headless}) …`);
      context = await chromium.launchPersistentContext(config.userDataDir, {
        ...launchOpts,
        channel: config.browserChannel,
      });
    } catch (err) {
      console.warn(`  Chrome channel unavailable (${err.message}); using bundled Chromium.`);
    }
  }
  if (!context) {
    console.log(`Launching bundled Chromium (persistent, headless=${config.headless}) …`);
    context = await chromium.launchPersistentContext(config.userDataDir, launchOpts);
  }

  await context.addInitScript(() => {
    // Hide the most common automation tell.
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = context.pages()[0] ?? (await context.newPage());
  return { context, page };
}

/**
 * Navigate to the base site and wait until Cloudflare's challenge clears,
 * i.e. until a `_csrfToken` cookie exists and the page is no longer the
 * "Just a moment" interstitial. Polls and reloads as needed.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<string>}  The CSRF token.
 */
async function passCloudflare(page) {
  console.log(`Navigating to ${config.baseUrl} …`);
  await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

  const deadline = Date.now() + config.cloudflareWaitSec * 1000;
  let reloads = 0;
  while (Date.now() < deadline) {
    const title = await page.title().catch(() => '');
    const token = await readCsrfToken(page);
    const challenged = /just a moment|attention required|verifying/i.test(title);

    if (token && !challenged) {
      console.log(`CSRF token acquired (${token.slice(0, 6)}…).`);
      return token;
    }
    await sleep(2500);
    // Occasionally the interstitial needs a nudge.
    if (challenged && reloads < 3 && Date.now() + 6000 < deadline) {
      reloads += 1;
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    }
  }
  throw new Error(
    `Cloudflare challenge did not clear within ${config.cloudflareWaitSec}s. ` +
      'Run locally with WN_HEADLESS=0 once to solve it (the .wn-profile is reused), ' +
      'then re-run.',
  );
}

/** Entry point. */
async function main() {
  const opts = { maxRetries: config.maxRetries, delayMs: config.delayMs };
  await mkdir(config.outDir, { recursive: true });

  // Echo the effective settings so an accidental leftover env var (e.g. a
  // WN_MAX_TAGS_PER_CATEGORY from a previous test shell) is immediately visible.
  console.log(
    'Settings: ' +
      `categories=[${config.categoryTypes}] sexes=[${config.sexes}] ` +
      `maxPagesPerTag=${config.maxPagesPerTag} ` +
      `maxTagsPerCategory=${config.maxTagsPerCategory || 'all'} ` +
      `concurrency=${config.concurrency} minChapters=${config.minChapters} ` +
      `channel=${config.browserChannel || 'chromium'} headless=${config.headless}`,
  );

  const { context, page } = await launchStealthContext();

  try {
    const token = await passCloudflare(page);

    const allBooks = new Map();
    for (const categoryType of config.categoryTypes) {
      const { tags, books } = await crawlCategory(page, token, categoryType, opts);
      await writeJson(config.outDir, `tags-${CATEGORY_LABELS[categoryType]}.json`, tags);
      for (const book of books) {
        // Books can appear in both pools; keep the first compact record but
        // union tag ids so client-side filtering stays accurate.
        const existing = allBooks.get(book.id);
        if (existing) {
          existing.t = [...new Set([...existing.t, ...book.t])];
        } else {
          allBooks.set(book.id, book);
        }
      }
    }

    const index = {
      generatedAt: new Date().toISOString(),
      count: allBooks.size,
      categoryTypes: config.categoryTypes,
      books: [...allBooks.values()],
    };
    await writeJson(config.outDir, 'books-index.json', index);

    console.log(`\nDone. ${allBooks.size} unique books indexed.`);
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error('\nCrawl failed:', err);
  process.exitCode = 1;
});
