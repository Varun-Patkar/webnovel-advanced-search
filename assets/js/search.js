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
 * @property {Set<number>} include  Tag ids the book MUST have (AND).
 * @property {Set<number>} exclude  Tag ids the book must NOT have.
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
 * Does a book satisfy every active filter?
 * @param {any} book
 * @param {Filters} f
 * @param {string} keywordLower  Pre-lowercased keyword (perf).
 * @returns {boolean}
 */
function matches(book, f, keywordLower) {
  if (f.type !== 'all' && book.ct !== f.type) return false;
  if (f.minRating > 0 && (book.s ?? 0) < f.minRating) return false;
  if (f.minChapters > 0 && (book.ch ?? 0) < f.minChapters) return false;

  if (keywordLower && !haystack(book).includes(keywordLower)) return false;

  // Tag constraints. `t` is an array of numeric tag ids.
  if (f.include.size || f.exclude.size) {
    const tags = book.t ?? [];
    for (const id of f.include) {
      if (!tags.includes(id)) return false;
    }
    for (const id of f.exclude) {
      if (tags.includes(id)) return false;
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
 * @returns {any[]}  New array of matching books, sorted.
 */
export function runSearch(books, filters) {
  const keywordLower = filters.keyword.trim().toLowerCase();
  const result = books.filter((book) => matches(book, filters, keywordLower));
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
