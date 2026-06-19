/**
 * search.js
 * -----------------------------------------------------------------------------
 * Pure, framework-free filtering and sorting over the in-memory book index.
 * Everything here is synchronous and side-effect free so it is easy to test and
 * fast enough to run on every keystroke for tens of thousands of books.
 */

/**
 * @typedef {Object} Filters
 * @property {string} keyword       Free text matched against title/author/desc.
 * @property {('all'|number)} type  'all', or a categoryType (1 novel / 4 fanfic).
 * @property {number} minRating     Minimum totalScore.
 * @property {number} minChapters   Minimum chapter count.
 * @property {Set<string>} include  Tag names the book MUST have (AND).
 * @property {Set<string>} exclude  Tag names the book must NOT have.
 * @property {('col'|'v'|'s'|'ch')} sortBy  Sort key.
 */

/**
 * Build a lowercase haystack for keyword matching, memoised on the book object
 * so repeated searches don't re-concatenate strings.
 * @param {any} book
 * @returns {string}
 */
function haystack(book) {
  if (book.__hay === undefined) {
    book.__hay = `${book.n} ${book.a} ${book.d}`.toLowerCase();
  }
  return book.__hay;
}

/**
 * Build (and memoise) a Set of a book's tag ids for fast membership tests.
 * @param {any} book
 * @returns {Set<number>}
 */
function tagSet(book) {
  if (book.__tset === undefined) {
    book.__tset = new Set(book.t ?? []);
  }
  return book.__tset;
}

/**
 * Does a book satisfy every active filter?
 * @param {any} book
 * @param {Filters} f
 * @param {string} keywordLower  Pre-lowercased keyword (perf).
 * @param {Record<string, number[]>} nameToIds  Tag name -> all ids sharing it.
 * @returns {boolean}
 */
function matches(book, f, keywordLower, nameToIds) {
  if (f.type !== 'all' && book.ct !== f.type) return false;
  if (f.minRating > 0 && (book.s ?? 0) < f.minRating) return false;
  if (f.minChapters > 0 && (book.ch ?? 0) < f.minChapters) return false;

  if (keywordLower && !haystack(book).includes(keywordLower)) return false;

  // Tag constraints are matched by name. A merged tag name may resolve to more
  // than one id, so a book satisfies it when it carries ANY of those ids.
  if (f.include.size || f.exclude.size) {
    const tset = tagSet(book);
    for (const name of f.include) {
      const ids = nameToIds[name];
      if (!ids || !ids.some((id) => tset.has(id))) return false;
    }
    for (const name of f.exclude) {
      const ids = nameToIds[name];
      if (ids && ids.some((id) => tset.has(id))) return false;
    }
  }
  return true;
}

/** Comparators for each sort key (all descending). */
const COMPARATORS = {
  col: (a, b) => (b.col ?? 0) - (a.col ?? 0),
  v: (a, b) => (b.v ?? 0) - (a.v ?? 0),
  s: (a, b) => (b.s ?? 0) - (a.s ?? 0),
  ch: (a, b) => (b.ch ?? 0) - (a.ch ?? 0),
};

/**
 * Filter and sort the full book list.
 * @param {any[]} books
 * @param {Filters} filters
 * @param {Record<string, number[]>} nameToIds  Tag name -> all ids sharing it.
 * @returns {any[]}  New array of matching books, sorted.
 */
export function runSearch(books, filters, nameToIds = {}) {
  const keywordLower = filters.keyword.trim().toLowerCase();
  const result = books.filter((book) => matches(book, filters, keywordLower, nameToIds));
  const cmp = COMPARATORS[filters.sortBy] ?? COMPARATORS.col;
  result.sort(cmp);
  return result;
}

/**
 * Create an empty filter state.
 * @returns {Filters}
 */
export function defaultFilters() {
  return {
    keyword: '',
    type: 'all',
    minRating: 0,
    minChapters: 0,
    include: new Set(),
    exclude: new Set(),
    sortBy: 'col',
  };
}
