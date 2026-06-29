/**
 * app.js
 * -----------------------------------------------------------------------------
 * Application entry point: loads the snapshot, wires up the filter controls and
 * re-renders results on every change. State lives here; rendering lives in
 * ui.js; filtering lives in search.js.
 */

import { loadSnapshot } from './data.js';
import { defaultFilters, runSearch, countTagsByName } from './search.js';
import { filtersToParams, filtersToUrl, paramsToFilters, saveFilters, loadStoredFilters } from './urlState.js';
import {
  renderAvailableTags,
  renderResults,
  renderResultsBar,
  renderSnapshotMeta,
  renderSelectedCloud,
} from './ui.js';

/** How many cards to reveal per page / "Show more" click. */
const PAGE_SIZE = 60;

/** Grab all the elements we interact with once, up front. */
const els = {
  snapshotMeta: document.getElementById('snapshotMeta'),
  keyword: document.getElementById('keyword'),
  typeSegmented: document.getElementById('typeSegmented'),
  minRating: document.getElementById('minRating'),
  minChapters: document.getElementById('minChapters'),
  sortBy: document.getElementById('sortBy'),
  tagFilter: document.getElementById('tagFilter'),
  availableTags: document.getElementById('availableTags'),
  includeTags: document.getElementById('includeTags'),
  excludeTags: document.getElementById('excludeTags'),
  includeCount: document.getElementById('includeCount'),
  excludeCount: document.getElementById('excludeCount'),
  includeMode: document.getElementById('includeMode'),
  excludeMode: document.getElementById('excludeMode'),
  includeHint: document.getElementById('includeHint'),
  excludeHint: document.getElementById('excludeHint'),
  resetBtn: document.getElementById('resetBtn'),
  shareBtn: document.getElementById('shareBtn'),
  resultsGrid: document.getElementById('resultsGrid'),
  resultCount: document.getElementById('resultCount'),
  activeFilters: document.getElementById('activeFilters'),
  emptyState: document.getElementById('emptyState'),
  loadMoreBtn: document.getElementById('loadMoreBtn'),
  endOfList: document.getElementById('endOfList'),
};

/** Mutable application state. */
const state = {
  snapshot: { books: [], generatedAt: null, tagName: {}, nameToIds: {}, tags: [] },
  filters: defaultFilters(),
  results: [],
  shown: 0,
};

/**
 * Debounce a function so rapid events (typing) collapse into one call.
 * @param {Function} fn
 * @param {number} ms
 * @returns {Function}
 */
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Cycle a tag through the three states: neutral → include → exclude → neutral.
 * Tags are identified by name so merged duplicates behave as one.
 * @param {string} name
 */
function toggleTag(name) {
  const { include, exclude } = state.filters;
  if (include.has(name)) {
    include.delete(name);
    exclude.add(name);
  } else if (exclude.has(name)) {
    exclude.delete(name);
  } else {
    include.add(name);
  }
  refreshTagClouds();
  applyAndRender();
}

/**
 * Update the wording of the include/exclude hints to match the chosen modes,
 * and reflect the active mode button in each toggle.
 */
function refreshModeUi() {
  const { includeMode, excludeMode } = state.filters;
  els.includeHint.innerHTML =
    includeMode === 'OR'
      ? 'Book must have <strong>any</strong> included tag.'
      : 'Book must have <strong>all</strong> included tags.';
  els.excludeHint.innerHTML =
    excludeMode === 'AND'
      ? 'Hide books only if they have <strong>all</strong> excluded tags.'
      : 'Hide books that have <strong>any</strong> excluded tag.';
  for (const btn of els.includeMode.children) {
    btn.classList.toggle('active', btn.dataset.mode === includeMode);
  }
  for (const btn of els.excludeMode.children) {
    btn.classList.toggle('active', btn.dataset.mode === excludeMode);
  }
}

/** Re-render the three tag sections to reflect current selections + type. */
function refreshTagClouds() {
  const { include, exclude, type } = state.filters;
  // Counts/visibility of available tags reflect the current filtered results.
  const tagCounts = countTagsByName(state.results, state.snapshot.tags);
  renderAvailableTags(
    els.availableTags,
    state.snapshot.tags,
    include,
    exclude,
    els.tagFilter.value,
    type,
    toggleTag,
    tagCounts,
  );
  renderSelectedCloud(els.includeTags, include, 'include', 'None.', toggleTag);
  renderSelectedCloud(els.excludeTags, exclude, 'exclude', 'None.', toggleTag);
  els.includeCount.textContent = include.size ? `(${include.size})` : '';
  els.excludeCount.textContent = exclude.size ? `(${exclude.size})` : '';
}

/**
 * Build a short human summary of the active filters for the results bar.
 * @returns {string}
 */
function filterSummary() {
  const { filters } = state;
  const parts = [];
  if (filters.type !== 'all') parts.push(filters.type === 4 ? 'Fanfic' : 'Novel');
  const joinInc = filters.includeMode === 'OR' ? ' / ' : ' + ';
  const inc = [...filters.include].map((n) => `#${n}`).join(joinInc);
  if (inc) parts.push(inc);
  const joinExc = filters.excludeMode === 'AND' ? ' + ' : ' / ';
  const exc = [...filters.exclude].map((n) => `−#${n}`).join(joinExc);
  if (exc) parts.push(exc);
  if (filters.minRating > 0) parts.push(`★≥${filters.minRating}`);
  if (filters.minChapters > 0) parts.push(`📖≥${filters.minChapters}`);
  return parts.join('  ');
}

/**
 * Reflect the current filter state into the URL query string without adding a
 * history entry, so the address bar always mirrors the active view and can be
 * copied/shared at any moment.
 */
function syncUrl() {
  const params = filtersToParams(state.filters);
  const query = params.toString();
  const url = query ? `${window.location.pathname}?${query}` : window.location.pathname;
  window.history.replaceState(null, '', url);
  // Remember the latest filters so the next bare visit restores them.
  saveFilters(state.filters);
}

/**
 * Push the values held in `state.filters` back into the DOM controls. Used when
 * filters originate from somewhere other than a direct user interaction (e.g.
 * restored from the URL on load).
 */
function syncControlsFromState() {
  const { filters } = state;
  els.keyword.value = filters.keyword;
  els.minRating.value = String(filters.minRating);
  els.minChapters.value = String(filters.minChapters);
  els.sortBy.value = filters.sortBy;
  const typeStr = filters.type === 'all' ? 'all' : String(filters.type);
  [...els.typeSegmented.children].forEach((c) =>
    c.classList.toggle('active', c.dataset.type === typeStr),
  );
  refreshModeUi();
}

/** Re-run the search and repaint the first page of results. */
function applyAndRender() {
  syncUrl();
  state.results = runSearch(state.snapshot.books, state.filters, state.snapshot.nameToIds);
  state.shown = 0;
  // Recompute the available-tag pills against the freshly filtered results.
  refreshTagClouds();
  renderResultsBar(
    els.resultCount,
    els.activeFilters,
    state.results.length,
    filterSummary(),
  );
  els.emptyState.hidden = state.results.length > 0;
  showNextPage(false);
}

/**
 * Reveal the next PAGE_SIZE results.
 * @param {boolean} append  Append to the grid (true) or replace it (false).
 */
function showNextPage(append) {
  const next = state.results.slice(state.shown, state.shown + PAGE_SIZE);
  renderResults(els.resultsGrid, next, append);
  state.shown += next.length;
  const more = state.shown < state.results.length;
  els.loadMoreBtn.hidden = !more;
  // Show a friendly end-of-list note only when there are results but no more
  // pages to reveal.
  els.endOfList.hidden = more || state.results.length === 0;
}

/** Attach all event listeners. */
function wireEvents() {
  els.keyword.addEventListener(
    'input',
    debounce(() => {
      state.filters.keyword = els.keyword.value;
      applyAndRender();
    }, 180),
  );

  els.typeSegmented.addEventListener('click', (event) => {
    const btn = event.target.closest('.seg');
    if (!btn) return;
    [...els.typeSegmented.children].forEach((c) => c.classList.remove('active'));
    btn.classList.add('active');
    const raw = btn.dataset.type;
    state.filters.type = raw === 'all' ? 'all' : Number(raw);
    refreshTagClouds();
    applyAndRender();
  });

  els.minRating.addEventListener('change', () => {
    state.filters.minRating = Number(els.minRating.value);
    applyAndRender();
  });

  els.minChapters.addEventListener('change', () => {
    state.filters.minChapters = Number(els.minChapters.value);
    applyAndRender();
  });

  els.sortBy.addEventListener('change', () => {
    state.filters.sortBy = els.sortBy.value;
    applyAndRender();
  });

  els.tagFilter.addEventListener('input', debounce(refreshTagClouds, 120));

  // Include / Exclude AND-OR match-mode toggles.
  els.includeMode.addEventListener('click', (event) => {
    const btn = event.target.closest('.seg');
    if (!btn) return;
    state.filters.includeMode = btn.dataset.mode === 'OR' ? 'OR' : 'AND';
    refreshModeUi();
    applyAndRender();
  });
  els.excludeMode.addEventListener('click', (event) => {
    const btn = event.target.closest('.seg');
    if (!btn) return;
    state.filters.excludeMode = btn.dataset.mode === 'AND' ? 'AND' : 'OR';
    refreshModeUi();
    applyAndRender();
  });

  els.loadMoreBtn.addEventListener('click', () => showNextPage(true));

  els.shareBtn.addEventListener('click', async () => {
    const url = filtersToUrl(state.filters);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API can be blocked (e.g. insecure context); fall back to a
      // hidden textarea + execCommand so sharing still works.
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    const original = els.shareBtn.textContent;
    els.shareBtn.textContent = 'Copied!';
    els.shareBtn.classList.add('copied');
    setTimeout(() => {
      els.shareBtn.textContent = original;
      els.shareBtn.classList.remove('copied');
    }, 1500);
  });

  els.resetBtn.addEventListener('click', () => {
    state.filters = defaultFilters();
    els.keyword.value = '';
    els.tagFilter.value = '';
    els.minRating.value = '0';
    els.minChapters.value = '0';
    els.sortBy.value = 'col';
    [...els.typeSegmented.children].forEach((c, i) =>
      c.classList.toggle('active', i === 0),
    );
    refreshModeUi();
    refreshTagClouds();
    applyAndRender();
  });
}

/** Bootstrap. */
async function init() {
  state.snapshot = await loadSnapshot();
  // Filters come from the URL if present (shared link), otherwise from the
  // last session saved in localStorage, otherwise the defaults.
  state.filters = window.location.search
    ? paramsToFilters()
    : loadStoredFilters() ?? defaultFilters();
  syncControlsFromState();
  renderSnapshotMeta(
    els.snapshotMeta,
    state.snapshot.generatedAt,
    state.snapshot.books.length,
  );
  refreshTagClouds();
  wireEvents();
  applyAndRender();
}

init();
