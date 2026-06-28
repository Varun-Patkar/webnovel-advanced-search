/**
 * config.mjs
 * -----------------------------------------------------------------------------
 * Central configuration for the WebNovel snapshot crawler.
 *
 * Every value here can be overridden at runtime with an environment variable
 * (handy for the GitHub Actions "Run workflow" form). This keeps the crawler's
 * behaviour fully data-driven without code edits.
 *
 * The crawler is intentionally bounded: WebNovel's full catalogue is far too
 * large to mirror into a single client-searchable JSON file, so we crawl a
 * configurable number of pages per tag and de-duplicate the resulting books.
 */

/**
 * Read an integer from the environment, falling back to a default.
 * @param {string} name  Environment variable name.
 * @param {number} fallback  Value used when the variable is missing/invalid.
 * @returns {number}
 */
function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Read a comma-separated list of integers from the environment.
 * @param {string} name  Environment variable name.
 * @param {number[]} fallback  Value used when the variable is missing.
 * @returns {number[]}
 */
function envIntList(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((value) => Number.isFinite(value));
}

export const config = {
  /**
   * Origin the crawler runs against. Requests are made *same-origin* from a
   * real browser page loaded on this site, which is why they bypass the
   * cross-origin `400` gate documented in API_RESEARCH.md.
   */
  baseUrl: process.env.WN_BASE_URL || 'https://www.webnovel.com',

  /**
   * Category types to crawl. 1 = Novel, 4 = Fanfic (see API_RESEARCH.md §4).
   * Override with WN_CATEGORY_TYPES="1" to crawl novels only, etc.
   */
  categoryTypes: envIntList('WN_CATEGORY_TYPES', [1, 4]),

  /**
   * Audience pools to merge. 1 = male-oriented, 2 = female-oriented. Crawling
   * both widens coverage; books are de-duplicated by id afterwards.
   */
  sexes: envIntList('WN_SEXES', [1, 2]),

  /**
   * Maximum result pages to fetch per (tag × sex) combination. Combined with
   * the concurrency pool below, this is the main lever on how many books are
   * pulled. Raising it deepens coverage; the concurrency pool keeps the extra
   * pages from costing proportionally more wall-clock time.
   */
  maxPagesPerTag: envInt('WN_MAX_PAGES_PER_TAG', 3),

  /**
   * How many tags to crawl in parallel. The crawl is latency-bound (each
   * request waits on the network), so a small pool multiplies throughput and
   * lets us pull more pages in roughly the same wall-clock time. Keep this
   * modest to stay polite and avoid tripping Cloudflare / rate limits.
   */
  concurrency: envInt('WN_CONCURRENCY', 3),

  /**
   * Minimum chapter count a book must have to be kept in the snapshot. Books
   * below this are discarded during the crawl, keeping the index focused on
   * substantial, long-running stories. WebNovel's own server-side filter only
   * buckets at 300/1000, so this finer threshold is applied client-side using
   * each book's `chapterNum`.
   */
  minChapters: envInt('WN_MIN_CHAPTERS', 100),

  /**
   * Optional cap on how many tags to crawl per category (0 = all tags in the
   * catalogue). Useful for quick test runs.
   */
  maxTagsPerCategory: envInt('WN_MAX_TAGS_PER_CATEGORY', 0),

  /** Sort order passed to get-search-list (1 ≈ popular). */
  orderBy: envInt('WN_ORDER_BY', 1),

  /** Politeness delay between API calls, in milliseconds. */
  delayMs: envInt('WN_DELAY_MS', 350),

  /** Per-request retry attempts before giving up on a page. */
  maxRetries: envInt('WN_MAX_RETRIES', 3),

  /** Characters of book description to keep (full text bloats the index). */
  descriptionLimit: envInt('WN_DESCRIPTION_LIMIT', 400),

  /** Output directory for generated JSON, relative to the repo root. */
  outDir: process.env.WN_OUT_DIR || 'data',

  /** Run the browser headless. Set WN_HEADLESS=0 to watch it locally. */
  headless: process.env.WN_HEADLESS !== '0',

  /**
   * Browser channel. Cloudflare's managed challenge tends to *loop* forever
   * against Playwright's bundled Chromium (it's flagged as automation), so we
   * default to the real installed Google Chrome, which passes far more
   * reliably. Set WN_CHANNEL="" to force the bundled Chromium instead.
   */
  browserChannel: process.env.WN_CHANNEL ?? 'chrome',

  /**
   * Persistent user-data directory. Reusing a profile lets the `cf_clearance`
   * cookie survive between runs, so subsequent crawls skip the challenge
   * entirely. Relative to the repo root; git-ignored.
   */
  userDataDir: process.env.WN_USER_DATA_DIR || '.wn-profile',

  /** Max seconds to wait for the Cloudflare challenge to clear. */
  cloudflareWaitSec: envInt('WN_CF_WAIT_SEC', 45),
};

/** Human-readable label for a category type. */
export const CATEGORY_LABELS = { 1: 'novel', 4: 'fanfic' };
