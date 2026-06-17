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
 * Merge the per-category tag catalogues into a single id→name map and a grouped
 * structure for rendering. Group names are suffixed with their category when a
 * collision would otherwise hide one.
 * @param {object|null} novel  tags-novel.json contents.
 * @param {object|null} fanfic tags-fanfic.json contents.
 * @returns {{ tagName: Record<number,string>, groups: Array<{categoryType:number, name:string, tags:any[]}> }}
 */
function buildTagModel(novel, fanfic) {
  const tagName = {};
  const groups = [];

  for (const catalogue of [novel, fanfic]) {
    if (!catalogue) continue;
    for (const group of catalogue.groups ?? []) {
      groups.push({
        categoryType: catalogue.categoryType,
        name: group.name,
        tags: group.tags ?? [],
      });
      for (const tag of group.tags ?? []) {
        tagName[tag.id] = tag.name;
      }
    }
  }
  return { tagName, groups };
}

/**
 * Load the entire snapshot (book index + tag catalogues) in parallel.
 * @returns {Promise<{
 *   books: any[],
 *   generatedAt: string|null,
 *   tagName: Record<number,string>,
 *   groups: Array<{categoryType:number, name:string, tags:any[]}>
 * }>}
 */
export async function loadSnapshot() {
  const [index, novel, fanfic] = await Promise.all([
    loadJson(PATHS.index, { books: [], generatedAt: null }),
    loadJson(PATHS.tagsNovel, null),
    loadJson(PATHS.tagsFanfic, null),
  ]);

  const { tagName, groups } = buildTagModel(novel, fanfic);
  return {
    books: index.books ?? [],
    generatedAt: index.generatedAt ?? null,
    tagName,
    groups,
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
