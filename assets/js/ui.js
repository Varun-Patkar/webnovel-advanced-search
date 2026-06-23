/**
 * ui.js
 * -----------------------------------------------------------------------------
 * DOM rendering helpers. These functions own *how* things look; app.js owns the
 * state and wiring. Keeping rendering isolated keeps app.js small and readable.
 */

import { coverUrl } from './data.js';

/** Compact number formatter, e.g. 105399003 -> "105.4M". */
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/**
 * Escape a string for safe insertion as text content via template literals.
 * (We mostly use textContent, but titles flow through innerHTML in cards.)
 * @param {string} value
 * @returns {string}
 */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render the snapshot freshness line in the header.
 * @param {HTMLElement} el
 * @param {string|null} generatedAt  ISO timestamp.
 * @param {number} bookCount
 */
export function renderSnapshotMeta(el, generatedAt, bookCount) {
  if (!generatedAt) {
    el.textContent = 'No snapshot found yet — run the crawler.';
    return;
  }
  const when = new Date(generatedAt);
  const date = when.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  el.innerHTML =
    `${compact.format(bookCount)} books · ` +
    `last refreshed <time datetime="${when.toISOString()}">${date}</time>`;
}

/**
 * Render the "available" tag cloud: every tag that is neither included nor
 * excluded, restricted to the active content type. Tags are keyed by name, so
 * duplicate names across categories collapse into a single chip.
 * @param {HTMLElement} container
 * @param {Array<{name:string, types:number[], ids:number[]}>} tags  Merged tags.
 * @param {Set<string>} include
 * @param {Set<string>} exclude
 * @param {string} filterText        Only show tags whose name contains this.
 * @param {('all'|number)} type      Active type filter (1 novel / 4 fanfic / 'all').
 * @param {(name:string)=>void} onToggle
 * @param {Map<string, number>} [counts]  Per-name book counts within the current
 *   filtered result set. When provided, pills use these numbers and any tag
 *   with zero matching books is hidden.
 */
export function renderAvailableTags(container, tags, include, exclude, filterText, type, onToggle, counts) {
  container.innerHTML = '';
  const needle = filterText.trim().toLowerCase();
  let count = 0;

  for (const tag of tags) {
    // When a type is selected, only surface tags that exist in that category.
    if (type !== 'all' && !tag.types.includes(type)) continue;
    // Selected tags are rendered in the Included / Excluded sections instead.
    if (include.has(tag.name) || exclude.has(tag.name)) continue;
    if (needle && !tag.name.toLowerCase().includes(needle)) continue;

    // Number of books carrying this tag within the current filtered pile.
    // Falls back to the tag's global count when no filtered counts are given.
    const tagCount = counts ? (counts.get(tag.name) ?? 0) : (tag.count ?? 0);
    // Hide tags that have no books left after the active filters.
    if (counts && tagCount === 0) continue;

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tag';
    chip.title = `${tagCount} book${tagCount === 1 ? '' : 's'}`;

    const label = document.createElement('span');
    label.textContent = `#${tag.name}`;
    const pill = document.createElement('span');
    pill.className = 'tag-count';
    pill.textContent = compact.format(tagCount);
    chip.append(label, pill);

    chip.addEventListener('click', () => onToggle(tag.name));
    container.appendChild(chip);
    count++;
  }

  if (count === 0) {
    const span = document.createElement('span');
    span.className = 'hint';
    span.textContent = 'No tags match.';
    container.appendChild(span);
  }
}

/**
 * Render a cloud of currently-selected tag names (include or exclude set).
 * @param {HTMLElement} container
 * @param {Set<string>} names        Tag names to render.
 * @param {('include'|'exclude')} variant  CSS state class applied to each chip.
 * @param {string} emptyText         Shown when the set is empty.
 * @param {(name:string)=>void} onToggle
 */
export function renderSelectedCloud(container, names, variant, emptyText, onToggle) {
  container.innerHTML = '';
  if (names.size === 0) {
    const span = document.createElement('span');
    span.className = 'hint';
    span.textContent = emptyText;
    container.appendChild(span);
    return;
  }
  for (const name of names) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `tag ${variant}`;
    chip.textContent = `#${name}`;
    chip.addEventListener('click', () => onToggle(name));
    container.appendChild(chip);
  }
}

/**
 * Build a single result card element.
 * @param {any} book
 * @returns {HTMLAnchorElement}
 */
function cardFor(book) {
  const a = document.createElement('a');
  a.className = 'card';
  a.href = `https://www.webnovel.com/book/${book.id}`;
  a.target = '_blank';
  a.rel = 'noopener';
  // Native tooltip showing the full book name on hover, since the link/URL
  // (book id) gives no hint about the actual title.
  a.title = book.n;

  const typeLabel = book.ct === 4 ? 'Fanfic' : 'Novel';
  a.innerHTML = `
    <img class="card-cover" loading="lazy" alt="${esc(book.n)} cover"
         referrerpolicy="no-referrer"
         src="${coverUrl(book.id, book.cu)}"
         onerror="this.style.visibility='hidden'" />
    <div class="card-body">
      <span class="badge">${typeLabel} · ${esc(book.c)}</span>
      <span class="card-title">${esc(book.n)}</span>
      <span class="card-author">${esc(book.a)}</span>
      <span class="card-meta">
        <span class="star">★ ${(book.s ?? 0).toFixed(2)}</span>
        <span>📖 ${compact.format(book.ch ?? 0)}</span>
        <span>👁 ${compact.format(book.v ?? 0)}</span>
      </span>
    </div>`;
  return a;
}

/**
 * Render a page of results into the grid. Caller controls how many via slicing.
 * @param {HTMLElement} grid
 * @param {any[]} books  Already-sorted, already-sliced list to display.
 * @param {boolean} append  When true, add to existing children (load-more).
 */
export function renderResults(grid, books, append) {
  if (!append) grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const book of books) frag.appendChild(cardFor(book));
  grid.appendChild(frag);
}

/**
 * Update the result count + active-filter summary line.
 * @param {HTMLElement} countEl
 * @param {HTMLElement} summaryEl
 * @param {number} total
 * @param {string} summary
 */
export function renderResultsBar(countEl, summaryEl, total, summary) {
  countEl.textContent = `${compact.format(total)} result${total === 1 ? '' : 's'}`;
  summaryEl.textContent = summary;
}
