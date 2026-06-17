/**
 * app.js
 * -----------------------------------------------------------------------------
 * Application entry point: loads the snapshot, wires up the filter controls and
 * re-renders results on every change. State lives here; rendering lives in
 * ui.js; filtering lives in search.js.
 */

import { loadSnapshot } from './data.js';
import { defaultFilters, runSearch } from './search.js';
import {
  renderExcludeCloud,
  renderResults,
  renderResultsBar,
  renderSnapshotMeta,
  renderTagCloud,
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
  includeTags: document.getElementById('includeTags'),
  excludeTags: document.getElementById('excludeTags'),
  includeCount: document.getElementById('includeCount'),
  excludeCount: document.getElementById('excludeCount'),
  resetBtn: document.getElementById('resetBtn'),
  resultsGrid: document.getElementById('resultsGrid'),
  resultCount: document.getElementById('resultCount'),
  activeFilters: document.getElementById('activeFilters'),
  emptyState: document.getElementById('emptyState'),
  loadMoreBtn: document.getElementById('loadMoreBtn'),
};

/** Mutable application state. */
const state = {
  snapshot: { books: [], generatedAt: null, tagName: {}, groups: [] },
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
 * @param {number} tagId
 */
function toggleTag(tagId) {
  const { include, exclude } = state.filters;
  if (include.has(tagId)) {
    include.delete(tagId);
    exclude.add(tagId);
  } else if (exclude.has(tagId)) {
    exclude.delete(tagId);
  } else {
    include.add(tagId);
  }
  refreshTagClouds();
  applyAndRender();
}

/** Re-render both tag clouds to reflect current selections. */
function refreshTagClouds() {
  const { include, exclude } = state.filters;
  renderTagCloud(
    els.includeTags,
    state.snapshot.groups,
    include,
    exclude,
    els.tagFilter.value,
    toggleTag,
  );
  renderExcludeCloud(els.excludeTags, exclude, state.snapshot.tagName, toggleTag);
  els.includeCount.textContent = include.size ? `(${include.size})` : '';
  els.excludeCount.textContent = exclude.size ? `(${exclude.size})` : '';
}

/**
 * Build a short human summary of the active filters for the results bar.
 * @returns {string}
 */
function filterSummary() {
  const { filters, snapshot } = state;
  const parts = [];
  if (filters.type !== 'all') parts.push(filters.type === 4 ? 'Fanfic' : 'Novel');
  for (const id of filters.include) parts.push(`#${snapshot.tagName[id] ?? id}`);
  for (const id of filters.exclude) parts.push(`−#${snapshot.tagName[id] ?? id}`);
  if (filters.minRating > 0) parts.push(`★≥${filters.minRating}`);
  if (filters.minChapters > 0) parts.push(`📖≥${filters.minChapters}`);
  return parts.join('  ');
}

/** Re-run the search and repaint the first page of results. */
function applyAndRender() {
  state.results = runSearch(state.snapshot.books, state.filters);
  state.shown = 0;
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
  els.loadMoreBtn.hidden = state.shown >= state.results.length;
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

  els.loadMoreBtn.addEventListener('click', () => showNextPage(true));

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
    refreshTagClouds();
    applyAndRender();
  });
}

/** Bootstrap. */
async function init() {
  state.snapshot = await loadSnapshot();
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
