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
 * Render the include-tag cloud. Each tag reflects its current state (neutral /
 * include / exclude) via CSS classes.
 * @param {HTMLElement} container
 * @param {Array<{categoryType:number, name:string, tags:any[]}>} groups
 * @param {Set<number>} include
 * @param {Set<number>} exclude
 * @param {string} filterText   Only show tags whose name contains this.
 * @param {(tagId:number)=>void} onToggle
 */
export function renderTagCloud(container, groups, include, exclude, filterText, onToggle) {
  container.innerHTML = '';
  const seen = new Set();
  const needle = filterText.trim().toLowerCase();

  for (const group of groups) {
    for (const tag of group.tags) {
      if (seen.has(tag.id)) continue;
      seen.add(tag.id);
      if (needle && !tag.name.includes(needle)) continue;

      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tag';
      chip.dataset.id = String(tag.id);
      chip.textContent = `#${tag.name}`;
      if (include.has(tag.id)) chip.classList.add('include');
      else if (exclude.has(tag.id)) chip.classList.add('exclude');
      chip.addEventListener('click', () => onToggle(tag.id));
      container.appendChild(chip);
    }
  }
}

/**
 * Render the "exclude" summary cloud (only currently-excluded tags).
 * @param {HTMLElement} container
 * @param {Set<number>} exclude
 * @param {Record<number,string>} tagName
 * @param {(tagId:number)=>void} onToggle
 */
export function renderExcludeCloud(container, exclude, tagName, onToggle) {
  container.innerHTML = '';
  if (exclude.size === 0) {
    const span = document.createElement('span');
    span.className = 'hint';
    span.textContent = 'None.';
    container.appendChild(span);
    return;
  }
  for (const id of exclude) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tag exclude';
    chip.textContent = `#${tagName[id] ?? id}`;
    chip.addEventListener('click', () => onToggle(id));
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
