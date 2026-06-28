/**
 * app.js
 * -----------------------------------------------------------------------------
 * Application entry point: loads the snapshot, wires up the filter controls and
 * re-renders results on every change. State lives here; rendering lives in
 * ui.js / treeUi.js / queryTextUi.js; filtering lives in search.js; the boolean
 * tag-query engine lives in query.js.
 */

import { loadSnapshot } from './data.js';
import { defaultFilters, runSearch, countTagsByName } from './search.js';
import {
  emptyExpr,
  isEmptyExpr,
  serializeExpr,
  parseQuery,
  collectTagNames,
  makeGroup,
  makeTag,
} from './query.js';
import { filtersToParams, filtersToUrl, paramsToFilters, saveFilters, loadStoredFilters } from './urlState.js';
import { renderTree } from './treeUi.js';
import {
  computeSuggestions,
  applySuggestion,
  insertTagAtCaret,
  renderStatus,
  renderSuggestions,
} from './queryTextUi.js';
import {
  renderAvailableTags,
  renderResults,
  renderResultsBar,
  renderSnapshotMeta,
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
  tagSummary: document.getElementById('tagSummary'),
  tagModeToggle: document.getElementById('tagModeToggle'),
  tagTreePanel: document.getElementById('tagTreePanel'),
  tagTextPanel: document.getElementById('tagTextPanel'),
  tagTree: document.getElementById('tagTree'),
  tagQuery: document.getElementById('tagQuery'),
  tagQueryStatus: document.getElementById('tagQueryStatus'),
  tagQuerySuggest: document.getElementById('tagQuerySuggest'),
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
  /** The group new palette-clicked tags land in (Builder mode). */
  activeGroup: null,
  /** Lowercased tag name -> canonical name, for resolving typed queries. */
  lcToName: new Map(),
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

/* -------------------------------------------------------------------------- */
/* Tag-query helpers                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a typed (lowercased) tag name to its canonical catalogue name.
 * @param {string} lower
 * @returns {string|null}
 */
function resolveName(lower) {
  return state.lcToName.get(lower) ?? null;
}

/** The tag catalogue restricted to the active content type. */
function tagsForType() {
  const { type } = state.filters;
  if (type === 'all') return state.snapshot.tags;
  return state.snapshot.tags.filter((t) => t.types.includes(type));
}

/**
 * Is `target` still reachable inside the current expression tree? Used after a
 * removal to decide whether the active group must fall back to the root.
 * @param {import('./query.js').Node} node
 * @param {import('./query.js').Node} target
 * @returns {boolean}
 */
function isReachable(node, target) {
  if (node === target) return true;
  if (node.k !== 'g') return false;
  return node.kids.some((kid) => isReachable(kid, target));
}

/** Guarantee the active group still exists, else reset it to the root. */
function ensureActiveGroup() {
  if (!state.activeGroup || !isReachable(state.filters.expr, state.activeGroup)) {
    state.activeGroup = state.filters.expr;
  }
}

/** Handlers handed to the visual builder; each mutates the tree then commits. */
const treeHandlers = {
  isActive: (group) => group === state.activeGroup,
  onSelect: (group) => {
    state.activeGroup = group;
    renderTree(els.tagTree, state.filters.expr, treeHandlers);
  },
  onToggleOp: (group) => {
    group.op = group.op === 'AND' ? 'OR' : 'AND';
    applyAndRender();
  },
  onToggleGroupNot: (group) => {
    group.not = !group.not;
    applyAndRender();
  },
  onAddGroup: (group) => {
    const child = makeGroup('AND');
    group.kids.push(child);
    state.activeGroup = child;
    applyAndRender();
  },
  onRemoveNode: (node, parent) => {
    const i = parent.kids.indexOf(node);
    if (i >= 0) parent.kids.splice(i, 1);
    ensureActiveGroup();
    applyAndRender();
  },
  onToggleTagNot: (tag) => {
    tag.not = !tag.not;
    applyAndRender();
  },
};

/**
 * Add or toggle a tag in a group: clicking a tag already present (same name,
 * non-negated) removes it, giving palette chips a familiar on/off feel.
 * @param {import('./query.js').GroupNode} group
 * @param {string} name
 */
function toggleTagInGroup(group, name) {
  const i = group.kids.findIndex((kid) => kid.k === 't' && kid.name === name && !kid.not);
  if (i >= 0) group.kids.splice(i, 1);
  else group.kids.push(makeTag(name));
}

/**
 * A palette chip was clicked. In Builder mode it drops into the active group;
 * in Query mode it is inserted at the caret of the text box.
 * @param {string} name
 */
function onPaletteToggle(name) {
  if (state.filters.tagMode === 'text') {
    const el = els.tagQuery;
    const caret = el.selectionStart ?? el.value.length;
    const { text, caret: nextCaret } = insertTagAtCaret(el.value, caret, name);
    el.value = text;
    el.focus();
    el.setSelectionRange(nextCaret, nextCaret);
    commitTextQuery();
    refreshSuggestions();
  } else {
    ensureActiveGroup();
    toggleTagInGroup(state.activeGroup, name);
    applyAndRender();
  }
}

/**
 * Parse the Query-mode text box and, when valid, commit it as the live filter.
 * Invalid drafts only update the status line so results don't thrash mid-type.
 */
function commitTextQuery() {
  const text = els.tagQuery.value;
  const parsed = parseQuery(text, resolveName);
  const empty = text.trim() === '';
  renderStatus(els.tagQueryStatus, parsed, empty);
  if (parsed.ok) {
    state.filters.expr = parsed.ast;
    ensureActiveGroup();
    applyAndRender();
  }
}

/** Recompute and render autocomplete suggestions for the current caret. */
function refreshSuggestions() {
  const el = els.tagQuery;
  const caret = el.selectionStart ?? el.value.length;
  const suggestions = computeSuggestions(el.value, caret, tagsForType());
  renderSuggestions(els.tagQuerySuggest, suggestions, (name) => {
    const { text, caret: nextCaret } = applySuggestion(
      el.value,
      el.selectionStart ?? el.value.length,
      name,
    );
    el.value = text;
    el.focus();
    el.setSelectionRange(nextCaret, nextCaret);
    commitTextQuery();
    refreshSuggestions();
  });
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

/** Re-render the palette and whichever tag editor is active. */
function refreshTagUi() {
  const usedNames = collectTagNames(state.filters.expr);
  // Counts/visibility of palette tags reflect the current filtered results.
  const tagCounts = countTagsByName(state.results, state.snapshot.tags);
  renderAvailableTags(
    els.availableTags,
    state.snapshot.tags,
    usedNames,
    els.tagFilter.value,
    state.filters.type,
    onPaletteToggle,
    tagCounts,
  );
  if (state.filters.tagMode === 'tree') {
    ensureActiveGroup();
    renderTree(els.tagTree, state.filters.expr, treeHandlers);
  }
  // Small "(n tags)" hint next to the field label.
  const n = usedNames.size;
  els.tagSummary.textContent = n ? `(${n} tag${n === 1 ? '' : 's'})` : '';
}

/**
 * Build a short human summary of the active filters for the results bar.
 * @returns {string}
 */
function filterSummary() {
  const { filters } = state;
  const parts = [];
  if (filters.type !== 'all') parts.push(filters.type === 4 ? 'Fanfic' : 'Novel');
  if (!isEmptyExpr(filters.expr)) parts.push(serializeExpr(filters.expr));
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
 * Switch between the Builder (tree) and Query (text) tag editors.
 * @param {'tree'|'text'} mode
 */
function setTagMode(mode) {
  state.filters.tagMode = mode;
  [...els.tagModeToggle.children].forEach((c) =>
    c.classList.toggle('active', c.dataset.tagmode === mode),
  );
  els.tagTreePanel.hidden = mode !== 'tree';
  els.tagTextPanel.hidden = mode !== 'text';

  if (mode === 'text') {
    // Show the current query as editable text and validate it.
    els.tagQuery.value = isEmptyExpr(state.filters.expr) ? '' : serializeExpr(state.filters.expr);
    const parsed = parseQuery(els.tagQuery.value, resolveName);
    renderStatus(els.tagQueryStatus, parsed, els.tagQuery.value.trim() === '');
    renderSuggestions(els.tagQuerySuggest, [], () => {});
  }
  syncUrl();
  refreshTagUi();
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
  setTagMode(filters.tagMode ?? 'tree');
}

/** Re-run the search and repaint the first page of results. */
function applyAndRender() {
  syncUrl();
  state.results = runSearch(state.snapshot.books, state.filters, state.snapshot.nameToIds);
  state.shown = 0;
  // Recompute the palette pills and tag editor against the freshly filtered set.
  refreshTagUi();
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

  els.tagFilter.addEventListener('input', debounce(refreshTagUi, 120));

  // Tag-mode switch (Builder / Query).
  els.tagModeToggle.addEventListener('click', (event) => {
    const btn = event.target.closest('.seg');
    if (!btn) return;
    setTagMode(btn.dataset.tagmode === 'text' ? 'text' : 'tree');
  });

  // Query-mode typing: validate + (when valid) apply, with live suggestions.
  els.tagQuery.addEventListener(
    'input',
    debounce(() => {
      commitTextQuery();
      refreshSuggestions();
    }, 160),
  );
  // Keep suggestions in step as the caret moves without changing the text.
  els.tagQuery.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
      refreshSuggestions();
    }
  });
  els.tagQuery.addEventListener('click', refreshSuggestions);
  els.tagQuery.addEventListener('blur', () => {
    // Delay so a suggestion mousedown can fire first.
    setTimeout(() => renderSuggestions(els.tagQuerySuggest, [], () => {}), 120);
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
    state.activeGroup = state.filters.expr;
    els.keyword.value = '';
    els.tagFilter.value = '';
    els.minRating.value = '0';
    els.minChapters.value = '0';
    els.sortBy.value = 'col';
    els.tagQuery.value = '';
    [...els.typeSegmented.children].forEach((c, i) =>
      c.classList.toggle('active', i === 0),
    );
    setTagMode('tree');
    applyAndRender();
  });
}

/** Bootstrap. */
async function init() {
  state.snapshot = await loadSnapshot();
  // Build the lowercase -> canonical tag-name index for resolving typed queries.
  for (const name of Object.keys(state.snapshot.nameToIds)) {
    state.lcToName.set(name.toLowerCase(), name);
  }
  // Filters come from the URL if present (shared link), otherwise from the
  // last session saved in localStorage, otherwise the defaults.
  state.filters = window.location.search
    ? paramsToFilters()
    : loadStoredFilters() ?? defaultFilters();
  if (!state.filters.expr) state.filters.expr = emptyExpr();
  state.activeGroup = state.filters.expr;
  syncControlsFromState();
  renderSnapshotMeta(
    els.snapshotMeta,
    state.snapshot.generatedAt,
    state.snapshot.books.length,
  );
  wireEvents();
  applyAndRender();
}

init();
