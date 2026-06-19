/**
 * data.js
 * -----------------------------------------------------------------------------
 * Loads the static snapshot JSON produced by the crawler and exposes it in a
 * ready-to-search shape. All data is fetched from same-origin static files, so
 * there is no CORS/CSRF involved at runtime (see API_RESEARCH.md for why that
 * matters).
 */

/** Relative paths to the generated snapshot files. */
const PATHS = {
  index: 'data/books-index.json',
  tagsNovel: 'data/tags-novel.json',
  tagsFanfic: 'data/tags-fanfic.json',
};

/**
 * Fetch and parse a JSON file, returning a fallback on any failure so a missing
 * snapshot (e.g. before the first crawl) degrades gracefully instead of
 * throwing.
 * @param {string} path
 * @param {unknown} fallback
 * @returns {Promise<any>}
 */
async function loadJson(path, fallback) {
  try {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) return fallback;
    return await res.json();
  } catch {
    return fallback;
  }
}

/**
 * Merge the per-category tag catalogues into structures keyed by tag *name*.
 * Tags are treated as identical when they share a name, even if WebNovel
 * assigns them different numeric ids per category (e.g. the same "onepiece"
 * tag exists under two ids). Merging avoids showing the same tag twice in the
 * "All" view and lets a single selection match either underlying id.
 * @param {object|null} novel  tags-novel.json contents.
 * @param {object|null} fanfic tags-fanfic.json contents.
 * @returns {{
 *   tagName: Record<number,string>,
 *   nameToIds: Record<string, number[]>,
 *   tags: Array<{name:string, types:number[], ids:number[]}>
 * }}
 */
function buildTagModel(novel, fanfic) {
  const tagName = {};
  /** name -> merged tag entry, preserving first-seen order via the Map. */
  const byName = new Map();

  for (const catalogue of [novel, fanfic]) {
    if (!catalogue) continue;
    const type = catalogue.categoryType;
    for (const group of catalogue.groups ?? []) {
      for (const tag of group.tags ?? []) {
        tagName[tag.id] = tag.name;

        let entry = byName.get(tag.name);
        if (!entry) {
          entry = { name: tag.name, types: [], ids: [] };
          byName.set(tag.name, entry);
        }
        // Collect every distinct id and category this name appears under.
        if (!entry.ids.includes(tag.id)) entry.ids.push(tag.id);
        if (!entry.types.includes(type)) entry.types.push(type);
      }
    }
  }

  const tags = [...byName.values()];
  const nameToIds = {};
  for (const entry of tags) nameToIds[entry.name] = entry.ids;

  return { tagName, nameToIds, tags };
}

/**
 * Count how many books carry each merged tag and order the tags by that count
 * (descending), falling back to alphabetical order on ties. A book counts once
 * per tag even when several of the tag's ids appear on it. Mutates each tag by
 * setting its `count` and returns the same (now sorted) array.
 * @param {Array<{name:string, types:number[], ids:number[], count?:number}>} tags
 * @param {any[]} books
 * @returns {Array<{name:string, types:number[], ids:number[], count:number}>}
 */
function countAndSortTags(tags, books) {
  // Map every id to its owning merged tag entry for O(1) lookups per book id.
  const idToEntry = new Map();
  for (const entry of tags) {
    entry.count = 0;
    for (const id of entry.ids) idToEntry.set(id, entry);
  }

  for (const book of books) {
    const counted = new Set();
    for (const id of book.t ?? []) {
      const entry = idToEntry.get(id);
      // Avoid double-counting a book whose tags share a merged name.
      if (entry && !counted.has(entry)) {
        counted.add(entry);
        entry.count++;
      }
    }
  }

  tags.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return tags;
}

/**
 * Load the entire snapshot (book index + tag catalogues) in parallel.
 * @returns {Promise<{
 *   books: any[],
 *   generatedAt: string|null,
 *   tagName: Record<number,string>,
 *   nameToIds: Record<string, number[]>,
 *   tags: Array<{name:string, types:number[], ids:number[], count:number}>
 * }>}
 */
export async function loadSnapshot() {
  const [index, novel, fanfic] = await Promise.all([
    loadJson(PATHS.index, { books: [], generatedAt: null }),
    loadJson(PATHS.tagsNovel, null),
    loadJson(PATHS.tagsFanfic, null),
  ]);

  const books = index.books ?? [];
  const { tagName, nameToIds, tags } = buildTagModel(novel, fanfic);
  countAndSortTags(tags, books);
  return {
    books,
    generatedAt: index.generatedAt ?? null,
    tagName,
    nameToIds,
    tags,
  };
}

/**
 * Build the public cover-image URL for a book id. WebNovel serves covers from
 * its image CDN; `coverUpdateTime` busts stale caches.
 * @param {string} bookId
 * @param {number} coverUpdateTime
 * @returns {string}
 */
export function coverUrl(bookId, coverUpdateTime) {
  const bust = coverUpdateTime ? `?coverUpdateTime=${coverUpdateTime}` : '';
  return `https://book-pic.webnovel.com/bookcover/${bookId}${bust}`;
}
