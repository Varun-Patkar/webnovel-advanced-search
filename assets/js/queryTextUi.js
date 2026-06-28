/**
 * queryTextUi.js
 * -----------------------------------------------------------------------------
 * Helpers for the typed "Query" mode: live validation feedback, tag
 * autocomplete, and caret-aware text insertion. All functions are pure or
 * touch only the elements handed to them; the parsing itself lives in query.js.
 */

import { makeTag, serializeExpr } from './query.js';

/** Characters that always terminate a tag fragment while typing. */
const HARD_DELIMS = '()"';

/**
 * Serialise a single tag name to its query-text token, quoting when required.
 * @param {string} name
 * @returns {string}
 */
function tagToken(name) {
  return serializeExpr(makeTag(name));
}

/**
 * Work out the tag fragment the caret is currently sitting inside, i.e. the
 * partial tag name being typed since the last delimiter or operator.
 * @param {string} text
 * @param {number} caret
 * @returns {{start:number, value:string}}
 */
export function currentFragment(text, caret) {
  const before = text.slice(0, caret);

  // Start just after the last hard delimiter.
  let start = 0;
  for (let i = before.length - 1; i >= 0; i -= 1) {
    if (HARD_DELIMS.includes(before[i])) {
      start = i + 1;
      break;
    }
  }

  // ...or after the last whole-word operator, whichever is later.
  const opRe = /\b(AND|OR|NOT)\b/gi;
  let m;
  while ((m = opRe.exec(before)) !== null) {
    const end = m.index + m[0].length;
    if (end > start) start = end;
  }

  // Skip leading whitespace so the fragment is the bare partial name.
  while (start < before.length && /\s/.test(before[start])) start += 1;

  return { start, value: before.slice(start) };
}

/**
 * Compute autocomplete suggestions for the fragment under the caret.
 * @param {string} text
 * @param {number} caret
 * @param {Array<{name:string, count?:number}>} tags  Candidate tags (already
 *   filtered by the active type if desired).
 * @param {number} [max]
 * @returns {Array<{name:string, count:number}>}
 */
export function computeSuggestions(text, caret, tags, max = 8) {
  const { value } = currentFragment(text, caret);
  const needle = value.trim().toLowerCase();
  if (!needle) return [];

  const out = [];
  for (const tag of tags) {
    if (tag.name.toLowerCase().includes(needle)) {
      out.push({ name: tag.name, count: tag.count ?? 0 });
      if (out.length >= max) break;
    }
  }
  return out;
}

/**
 * Replace the fragment under the caret with a chosen tag name.
 * @param {string} text
 * @param {number} caret
 * @param {string} name  Canonical tag name to insert.
 * @returns {{text:string, caret:number}}
 */
export function applySuggestion(text, caret, name) {
  const { start } = currentFragment(text, caret);
  const token = `${tagToken(name)} `;
  const next = text.slice(0, start) + token + text.slice(caret);
  return { text: next, caret: start + token.length };
}

/**
 * Insert a tag token at the caret (used when a palette tag is clicked in text
 * mode). Adds surrounding spaces so it never glues onto neighbouring text.
 * @param {string} text
 * @param {number} caret
 * @param {string} name
 * @returns {{text:string, caret:number}}
 */
export function insertTagAtCaret(text, caret, name) {
  const left = text.slice(0, caret);
  const right = text.slice(caret);
  const needLeadSpace = left.length > 0 && !/\s|\($/.test(left.slice(-1));
  const lead = needLeadSpace ? ' ' : '';
  const token = `${lead}${tagToken(name)} `;
  const next = left + token + right;
  return { text: next, caret: left.length + token.length };
}

/**
 * Paint the validation status line beneath the query box.
 * @param {HTMLElement} el
 * @param {{ok:boolean, error?:string, unknown:string[]}} parse
 * @param {boolean} isEmpty
 */
export function renderStatus(el, parse, isEmpty) {
  el.classList.remove('ok', 'err');

  if (isEmpty) {
    el.textContent = 'No tag filter — matches everything.';
    return;
  }
  if (parse.error) {
    el.classList.add('err');
    el.textContent = `✕ ${parse.error}`;
    return;
  }
  if (parse.unknown && parse.unknown.length) {
    el.classList.add('err');
    const list = parse.unknown.map((n) => `"${n}"`).join(', ');
    el.textContent = `✕ Unknown tag: ${list}`;
    return;
  }
  el.classList.add('ok');
  el.textContent = '✓ Valid query';
}

/**
 * Render the autocomplete suggestion list.
 * @param {HTMLElement} el
 * @param {Array<{name:string, count:number}>} suggestions
 * @param {(name:string)=>void} onPick
 */
export function renderSuggestions(el, suggestions, onPick) {
  el.innerHTML = '';
  if (suggestions.length === 0) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  for (const sug of suggestions) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'sugg-item';
    item.innerHTML = `<span>#${sug.name}</span>`;
    // Mouse down (not click) so the textarea doesn't lose its caret first.
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      onPick(sug.name);
    });
    el.appendChild(item);
  }
}
