/**
 * treeUi.js
 * -----------------------------------------------------------------------------
 * Renders the visual "Builder" for the boolean tag query: nested AND/OR groups
 * containing tag chips. This module is purely presentational — it walks the
 * expression tree from query.js and turns it into DOM, delegating every edit
 * back to the caller through a small set of handlers. State (the tree itself
 * and which group is "active") lives in app.js.
 *
 * Handlers contract (all receive live tree nodes):
 *   isActive(group)            -> boolean   Is this the active (target) group?
 *   onSelect(group)            -> void      Make this group the active target.
 *   onToggleOp(group)          -> void      Flip AND <-> OR.
 *   onToggleGroupNot(group)    -> void      Toggle negation of the group.
 *   onAddGroup(group)          -> void      Add an empty nested group.
 *   onRemoveNode(node, parent) -> void      Remove a tag or sub-group.
 *   onToggleTagNot(tag)        -> void      Toggle a tag's is / is-not state.
 */

/**
 * Build a small icon button (the little × / +, op and NOT toggles).
 * @param {string} label
 * @param {string} cls
 * @param {(e:MouseEvent)=>void} onClick
 * @param {boolean} [stop]  Stop click propagation (so it doesn't also select).
 * @returns {HTMLButtonElement}
 */
function btn(label, cls, onClick, stop = false) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  b.addEventListener('click', (e) => {
    if (stop) e.stopPropagation();
    onClick(e);
  });
  return b;
}

/**
 * Render a single tag chip with its is / is-not toggle and a remove button.
 * @param {import('./query.js').TagNode} tag
 * @param {import('./query.js').GroupNode} parent
 * @param {any} h  Handlers.
 * @returns {HTMLElement}
 */
function renderTag(tag, parent, h) {
  const chip = document.createElement('span');
  chip.className = `tq-tag${tag.not ? ' neg' : ''}`;

  // Clicking the body toggles is / is-not; the × removes the tag.
  const label = document.createElement('button');
  label.type = 'button';
  label.className = 'tq-tag-label';
  label.textContent = `${tag.not ? 'NOT ' : ''}#${tag.name}`;
  label.title = tag.not ? 'Book must NOT have this tag — click to require it' : 'Book must have this tag — click to negate';
  label.addEventListener('click', (e) => {
    e.stopPropagation();
    h.onToggleTagNot(tag);
  });

  const remove = btn('×', 'tq-x', () => h.onRemoveNode(tag, parent), true);
  remove.title = 'Remove tag';

  chip.append(label, remove);
  return chip;
}

/**
 * Recursively render a group node and all of its children.
 * @param {import('./query.js').GroupNode} group
 * @param {import('./query.js').GroupNode|null} parent  Null for the root.
 * @param {any} h  Handlers.
 * @returns {HTMLElement}
 */
function renderGroup(group, parent, h) {
  const box = document.createElement('div');
  box.className = 'tq-group';
  if (h.isActive(group)) box.classList.add('active');
  // Clicking anywhere on a group makes it the active target. Children stop
  // propagation so the innermost group wins.
  box.addEventListener('click', (e) => {
    e.stopPropagation();
    h.onSelect(group);
  });

  const head = document.createElement('div');
  head.className = 'tq-group-head';

  // NOT toggle for the whole group.
  const notBtn = btn(group.not ? 'NOT' : 'NOT', `tq-not${group.not ? ' on' : ''}`, () =>
    h.onToggleGroupNot(group),
  );
  notBtn.title = group.not ? 'Group is negated — click to un-negate' : 'Negate this whole group';

  // AND / OR operator toggle.
  const opBtn = btn(group.op, 'tq-op', () => h.onToggleOp(group));
  opBtn.title = 'Switch between AND / OR';

  const grow = document.createElement('span');
  grow.className = 'tq-grow';

  const addBtn = btn('+ group', 'tq-add', () => h.onAddGroup(group), true);
  addBtn.title = 'Add a nested group';

  head.append(notBtn, opBtn, grow, addBtn);

  // Only non-root groups can be removed.
  if (parent) {
    const del = btn('×', 'tq-x tq-x-group', () => h.onRemoveNode(group, parent), true);
    del.title = 'Remove this group';
    head.appendChild(del);
  }

  box.appendChild(head);

  const kids = document.createElement('div');
  kids.className = 'tq-kids';
  if (group.kids.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'tq-empty';
    empty.textContent = 'Empty — click tags below to add them here.';
    kids.appendChild(empty);
  } else {
    for (const kid of group.kids) {
      kids.appendChild(kid.k === 'g' ? renderGroup(kid, group, h) : renderTag(kid, group, h));
    }
  }
  box.appendChild(kids);

  return box;
}

/**
 * Render the whole builder into a container.
 * @param {HTMLElement} container
 * @param {import('./query.js').GroupNode} root
 * @param {any} handlers
 */
export function renderTree(container, root, handlers) {
  container.innerHTML = '';
  container.appendChild(renderGroup(root, null, handlers));
}
