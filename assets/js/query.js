/**
 * query.js
 * -----------------------------------------------------------------------------
 * The boolean tag-query engine. A single expression *tree* models every filter
 * the user can express, from a single tag up to arbitrarily nested logic such
 * as `(action AND romance) OR NOT comedy`.
 *
 * The same tree powers both the visual Builder (treeUi.js) and the typed Query
 * mode (queryTextUi.js): the Builder mutates the tree directly, while Query
 * mode serialises the tree to text and parses text back into a tree. Keeping
 * all of that logic here — pure and DOM-free — makes it trivial to test and
 * reason about.
 *
 * Node shapes
 * -----------
 *   Group: { k: 'g', op: 'AND' | 'OR', not: boolean, kids: Node[] }
 *   Tag:   { k: 't', name: string,    not: boolean }
 *
 * `not` negates the node (a tag the book must NOT have, or a whole group whose
 * result is inverted). The root of a query is always a group.
 */

/** @typedef {{k:'g', op:'AND'|'OR', not:boolean, kids:Node[]}} GroupNode */
/** @typedef {{k:'t', name:string, not:boolean}} TagNode */
/** @typedef {GroupNode|TagNode} Node */

/** Operator keywords recognised by the tokenizer (case-insensitive). */
const KEYWORDS = new Set(['AND', 'OR', 'NOT']);

/**
 * Create a fresh, empty group node.
 * @param {'AND'|'OR'} [op]
 * @returns {GroupNode}
 */
export function makeGroup(op = 'AND') {
  return { k: 'g', op, not: false, kids: [] };
}

/**
 * Create a tag node.
 * @param {string} name
 * @param {boolean} [not]
 * @returns {TagNode}
 */
export function makeTag(name, not = false) {
  return { k: 't', name, not };
}

/**
 * The default (empty) query: a root AND group with no children, which imposes
 * no constraint and therefore matches every book.
 * @returns {GroupNode}
 */
export function emptyExpr() {
  return makeGroup('AND');
}

/**
 * Is this the neutral, "matches everything" query? True for a root group that
 * has no children and is not itself negated.
 * @param {Node} node
 * @returns {boolean}
 */
export function isEmptyExpr(node) {
  return !!node && node.k === 'g' && node.kids.length === 0 && !node.not;
}

/**
 * Evaluate the expression against a single book's tag-id set.
 * @param {Node} node
 * @param {Set<number>} tset            The book's tag ids.
 * @param {Record<string, number[]>} nameToIds  Tag name -> all ids sharing it.
 * @returns {boolean}
 */
export function evalExpr(node, tset, nameToIds) {
  let res;
  if (node.k === 't') {
    const ids = nameToIds[node.name];
    // A merged tag name may map to several ids; the book carries the tag when
    // it has ANY of them.
    res = !!ids && ids.some((id) => tset.has(id));
  } else if (node.kids.length === 0) {
    // An empty group is a no-op constraint.
    res = true;
  } else if (node.op === 'OR') {
    res = node.kids.some((kid) => evalExpr(kid, tset, nameToIds));
  } else {
    res = node.kids.every((kid) => evalExpr(kid, tset, nameToIds));
  }
  return node.not ? !res : res;
}

/**
 * Collect every tag name referenced anywhere in the tree.
 * @param {Node} node
 * @param {Set<string>} [out]
 * @returns {Set<string>}
 */
export function collectTagNames(node, out = new Set()) {
  if (node.k === 't') out.add(node.name);
  else for (const kid of node.kids) collectTagNames(kid, out);
  return out;
}

/**
 * Does a tag name need quoting when serialised? We quote only when leaving it
 * bare would change how it tokenises: names containing parentheses, quotes, or
 * a word that collides with an operator keyword.
 * @param {string} name
 * @returns {boolean}
 */
function needsQuotes(name) {
  if (/[()"]/.test(name)) return true;
  return name.split(/\s+/).some((word) => KEYWORDS.has(word.toUpperCase()));
}

/**
 * Serialise an expression tree back into query text. The output always
 * re-parses into an equivalent tree (round-trip safe). The root is never
 * wrapped in parentheses; nested multi-child groups are wrapped to preserve
 * precedence.
 * @param {Node} node
 * @returns {string}
 */
export function serializeExpr(node) {
  if (node.k === 't') {
    const label = needsQuotes(node.name) ? `"${node.name}"` : node.name;
    return node.not ? `NOT ${label}` : label;
  }

  // Group: join children with the group operator, wrapping any child group
  // that has more than one child so precedence survives the round-trip.
  const op = node.op === 'OR' ? 'OR' : 'AND';
  const parts = node.kids.map((kid) => {
    const text = serializeExpr(kid);
    if (kid.k === 'g' && !kid.not && kid.kids.length > 1) return `(${text})`;
    return text;
  });
  let out = parts.join(` ${op} `);
  if (node.not) out = `NOT (${out})`;
  return out;
}

/**
 * Tokenise query text into a flat list of tokens. Consecutive bare words that
 * are not operators are merged into a single tag token, so multi-word tag
 * names like "slice of life" work without quoting.
 * @param {string} text
 * @returns {{toks:Array<any>}|{error:string, pos:number}}
 */
function tokenize(text) {
  const toks = [];
  const n = text.length;
  let i = 0;

  while (i < n) {
    const c = text[i];

    // Whitespace separates tokens but is otherwise ignored.
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i += 1;
      continue;
    }

    if (c === '(') {
      toks.push({ type: '(', pos: i });
      i += 1;
      continue;
    }
    if (c === ')') {
      toks.push({ type: ')', pos: i });
      i += 1;
      continue;
    }

    // Quoted literal tag — everything up to the closing quote is the name.
    if (c === '"') {
      let j = i + 1;
      let s = '';
      while (j < n && text[j] !== '"') {
        s += text[j];
        j += 1;
      }
      if (j >= n) return { error: 'Unterminated quote', pos: i };
      toks.push({ type: 'tag', value: s.trim(), pos: i });
      i = j + 1;
      continue;
    }

    // A bare word: read until the next delimiter.
    let j = i;
    let word = '';
    while (j < n && !' \t\n\r()"'.includes(text[j])) {
      word += text[j];
      j += 1;
    }
    const upper = word.toUpperCase();
    if (KEYWORDS.has(upper)) {
      toks.push({ type: upper, pos: i });
    } else {
      // Merge into a preceding word-built tag token so "slice of life" stays one.
      const last = toks[toks.length - 1];
      if (last && last.type === 'tag' && last.fromWords) {
        last.value += ` ${word}`;
      } else {
        toks.push({ type: 'tag', value: word, pos: i, fromWords: true });
      }
    }
    i = j;
  }

  return { toks };
}

/**
 * Toggle negation on a node in place and return it (used by `NOT`).
 * @param {Node} node
 * @returns {Node}
 */
function negate(node) {
  node.not = !node.not;
  return node;
}

/**
 * Parse query text into an expression tree with rich validation.
 *
 * Operator precedence (highest to lowest): NOT, AND, OR. Parentheses override.
 *
 * @param {string} text
 * @param {(lower:string)=>string|null} [resolveName]  Map a (lowercased) typed
 *   tag name to its canonical catalogue name, or null when unknown. Defaults to
 *   an identity resolver (every name accepted as typed) for context-free uses
 *   such as restoring from a URL.
 * @returns {{ok:boolean, ast:Node, error?:string, pos?:number, unknown:string[]}}
 */
export function parseQuery(text, resolveName = (lower) => lower) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return { ok: true, ast: emptyExpr(), unknown: [] };

  const lexed = tokenize(trimmed);
  if ('error' in lexed) {
    return { ok: false, ast: emptyExpr(), error: lexed.error, pos: lexed.pos, unknown: [] };
  }
  const toks = lexed.toks;
  const unknown = [];
  let p = 0;

  const peek = () => toks[p];
  const fail = (message, pos) => ({ ok: false, message, pos });

  /** atom := '(' expr ')' | TAG */
  function parseAtom() {
    const t = peek();
    if (!t) return fail('Expected a tag', trimmed.length);

    if (t.type === '(') {
      p += 1;
      const inner = parseOr();
      if (!inner.ok) return inner;
      const close = peek();
      if (!close || close.type !== ')') {
        return fail('Missing closing parenthesis )', close ? close.pos : trimmed.length);
      }
      p += 1;
      return { ok: true, node: inner.node };
    }

    if (t.type === 'tag') {
      p += 1;
      const typed = t.value.trim();
      const canonical = resolveName(typed.toLowerCase());
      if (canonical == null) unknown.push(typed);
      return { ok: true, node: makeTag(canonical ?? typed) };
    }

    return fail(`Unexpected "${t.type}"`, t.pos);
  }

  /** notExpr := NOT notExpr | atom */
  function parseNot() {
    const t = peek();
    if (t && t.type === 'NOT') {
      p += 1;
      const sub = parseNot();
      if (!sub.ok) return sub;
      return { ok: true, node: negate(sub.node) };
    }
    return parseAtom();
  }

  /** andExpr := notExpr (AND notExpr)* */
  function parseAnd() {
    const first = parseNot();
    if (!first.ok) return first;
    const kids = [first.node];
    while (peek() && peek().type === 'AND') {
      p += 1;
      const rhs = parseNot();
      if (!rhs.ok) return rhs;
      kids.push(rhs.node);
    }
    if (kids.length === 1) return { ok: true, node: kids[0] };
    return { ok: true, node: { k: 'g', op: 'AND', not: false, kids } };
  }

  /** orExpr := andExpr (OR andExpr)* */
  function parseOr() {
    const first = parseAnd();
    if (!first.ok) return first;
    const kids = [first.node];
    while (peek() && peek().type === 'OR') {
      p += 1;
      const rhs = parseAnd();
      if (!rhs.ok) return rhs;
      kids.push(rhs.node);
    }
    if (kids.length === 1) return { ok: true, node: kids[0] };
    return { ok: true, node: { k: 'g', op: 'OR', not: false, kids } };
  }

  const result = parseOr();
  if (!result.ok) {
    return { ok: false, ast: emptyExpr(), error: result.message, pos: result.pos, unknown };
  }

  // Reject trailing tokens (e.g. "A B" or "A )").
  const leftover = peek();
  if (leftover) {
    const what = leftover.type === 'tag' ? `"${leftover.value}"` : `"${leftover.type}"`;
    return {
      ok: false,
      ast: emptyExpr(),
      error: `Unexpected ${what} — add an operator like AND/OR`,
      pos: leftover.pos,
      unknown,
    };
  }

  // The root must always be a group so the rest of the app can rely on it.
  const ast = result.node.k === 'g' && !result.node.not ? result.node : { k: 'g', op: 'AND', not: false, kids: [result.node] };
  return { ok: unknown.length === 0, ast, unknown };
}
