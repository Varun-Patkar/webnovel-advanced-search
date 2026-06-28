/**
 * search.js
 * -----------------------------------------------------------------------------
 * Pure, framework-free filtering and sorting over the in-memory book index.
 * Everything here is synchronous and side-effect free so it is easy to test and
 * fast enough to run on every keystroke for tens of thousands of books.
 */

import { emptyExpr, isEmptyExpr, evalExpr } from './query.js';

/**
 * @typedef {Object} Filters
 * @property {string} keyword       Free text matched against title/author/desc.
 * @property {('all'|number)} type  'all', or a categoryType (1 novel / 4 fanfic).
 * @property {number} minRating     Minimum totalScore.
 * @property {number} minChapters   Minimum chapter count.
 * @property {import('./query.js').Node} expr  Boolean tag-query tree.
 * @property {('tree'|'text')} tagMode  Which tag editor the user last used.
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

  // The boolean tag query is evaluated against the book's tag-id set. An empty
  // query imposes no constraint, so we skip the work entirely in that case.
  if (!isEmptyExpr(f.expr)) {
    if (!evalExpr(f.expr, tagSet(book), nameToIds)) return false;
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
    expr: emptyExpr(),
    tagMode: 'tree',
    sortBy: 'col',
  };
}

/**
 * Count how many books in a given list carry each merged tag, keyed by tag
 * *name*. Used to recompute the "available tags" pills against the currently
 * filtered result set so the numbers reflect only what is on screen.
 * A book counts at most once per merged tag, even if several of the tag's ids
 * appear on it.
 * @param {any[]} books  The (already filtered) books to count over.
 * @param {Array<{name:string, ids:number[]}>} tags  Merged tag catalogue.
 * @returns {Map<string, number>}  Tag name -> book count within `books`.
 */
export function countTagsByName(books, tags) {
  // Map every tag id to its owning merged entry for O(1) per-id lookups.
  const idToEntry = new Map();
  for (const entry of tags) {
    for (const id of entry.ids) idToEntry.set(id, entry);
  }

  const counts = new Map();
  for (const book of books) {
    const counted = new Set();
    for (const id of book.t ?? []) {
      const entry = idToEntry.get(id);
      if (entry && !counted.has(entry)) {
        counted.add(entry);
        counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
      }
    }
  }
  return counts;
}

