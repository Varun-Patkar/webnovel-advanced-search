/**
 * urlState.js
 * -----------------------------------------------------------------------------
 * Two-way bridge between the active filter state and the page URL query string.
 * Serialising filters into `?q=...&type=...` lets users bookmark and share a
 * specific search, and lets the app restore that exact view on load.
 *
 * Only non-default values are written so shared links stay short and readable.
 */

import { defaultFilters } from './search.js';

/**
 * Map a Filters object into a URLSearchParams instance.
 * Only values that differ from the defaults are included, keeping links tidy.
 * @param {import('./search.js').Filters} filters
 * @returns {URLSearchParams}
 */
export function filtersToParams(filters) {
  const params = new URLSearchParams();

  if (filters.keyword) params.set('q', filters.keyword);
  if (filters.type !== 'all') params.set('type', String(filters.type));
  if (filters.minRating > 0) params.set('rating', String(filters.minRating));
  if (filters.minChapters > 0) params.set('chapters', String(filters.minChapters));
  if (filters.sortBy && filters.sortBy !== 'col') params.set('sort', filters.sortBy);
  if (filters.include.size) params.set('include', [...filters.include].join(','));
  if (filters.exclude.size) params.set('exclude', [...filters.exclude].join(','));

  return params;
}

/**
 * Build the full shareable URL (origin + path + encoded filters).
 * @param {import('./search.js').Filters} filters
 * @returns {string}
 */
export function filtersToUrl(filters) {
  const params = filtersToParams(filters);
  const query = params.toString();
  const base = `${window.location.origin}${window.location.pathname}`;
  return query ? `${base}?${query}` : base;
}

/**
 * Parse a URL query string back into a Filters object, falling back to the
 * defaults for anything missing or malformed.
 * @param {string} [search]  Defaults to the current `window.location.search`.
 * @returns {import('./search.js').Filters}
 */
export function paramsToFilters(search = window.location.search) {
  const params = new URLSearchParams(search);
  const filters = defaultFilters();

  const q = params.get('q');
  if (q) filters.keyword = q;

  const type = params.get('type');
  if (type === '1' || type === '4') filters.type = Number(type);

  const rating = Number(params.get('rating'));
  if (Number.isFinite(rating) && rating > 0) filters.minRating = rating;

  const chapters = Number(params.get('chapters'));
  if (Number.isFinite(chapters) && chapters > 0) filters.minChapters = chapters;

  const sort = params.get('sort');
  if (sort && ['col', 'v', 's', 'ch'].includes(sort)) filters.sortBy = sort;

  const include = params.get('include');
  if (include) {
    for (const name of include.split(',')) if (name) filters.include.add(name);
  }

  const exclude = params.get('exclude');
  if (exclude) {
    for (const name of exclude.split(',')) if (name) filters.exclude.add(name);
  }

  return filters;
}

/** localStorage key under which the last-used filter query string is kept. */
const STORAGE_KEY = 'wn-search-filters';

/**
 * Persist the current filters to localStorage as a query string so the next
 * visit to the bare home page restores them. Writes are best-effort: storage
 * may be unavailable (private mode, quota) and must never break the app.
 * @param {import('./search.js').Filters} filters
 */
export function saveFilters(filters) {
  try {
    localStorage.setItem(STORAGE_KEY, filtersToParams(filters).toString());
  } catch {
    /* storage unavailable — ignore */
  }
}

/**
 * Load previously saved filters from localStorage.
 * @returns {import('./search.js').Filters | null}  Saved filters, or null when
 *   nothing is stored or storage cannot be read.
 */
export function loadStoredFilters() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    return paramsToFilters(`?${saved}`);
  } catch {
    return null;
  }
}

