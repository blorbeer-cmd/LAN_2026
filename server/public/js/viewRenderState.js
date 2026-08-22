// Keeps interaction state stable when a view has to rebuild its DOM.
// View renderers are intentionally simple template functions, so replacing
// the complete view root is still common. This helper makes that replacement
// behave like an in-place update for the person currently using the view.

const DRAFT_SELECTOR = 'input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="tel"], textarea';

function cssEscape(value) {
  if (globalThis.CSS?.escape) return CSS.escape(String(value));
  return String(value).replace(/(["\\])/g, '\\$1');
}

function attributeSelector(element) {
  if (element.id) return `#${cssEscape(element.id)}`;

  const attributes = [...element.attributes]
    .filter((attribute) => attribute.name.startsWith('data-') && attribute.value)
    .slice(0, 2)
    .map((attribute) => `[${attribute.name}="${cssEscape(attribute.value)}"]`)
    .join('');
  if (attributes) return `${element.localName}${attributes}`;
  if (element.getAttribute('name')) {
    return `${element.localName}[name="${cssEscape(element.getAttribute('name'))}"]`;
  }
  if (element.getAttribute('aria-label')) {
    return `${element.localName}[aria-label="${cssEscape(element.getAttribute('aria-label'))}"]`;
  }
  const type = element.getAttribute('type');
  return `${element.localName}${type ? `[type="${cssEscape(type)}"]` : ''}`;
}

function uniqueSelector(element, root) {
  if (!(element instanceof Element) || !root.contains(element)) return null;
  const direct = attributeSelector(element);
  try {
    if (root.querySelectorAll(direct).length === 1) return direct;
  } catch {
    // Fall through to an ancestor-qualified selector.
  }

  let ancestor = element.parentElement;
  while (ancestor && ancestor !== root) {
    const ancestorSelector = attributeSelector(ancestor);
    const combined = `${ancestorSelector} ${direct}`;
    try {
      if (root.querySelectorAll(combined).length === 1) return combined;
    } catch {
      // Keep walking toward a more specific stable ancestor.
    }
    ancestor = ancestor.parentElement;
  }

  const path = [];
  let node = element;
  while (node && node !== root) {
    const siblings = node.parentElement
      ? [...node.parentElement.children].filter((sibling) => sibling.localName === node.localName)
      : [];
    const position = siblings.indexOf(node) + 1;
    path.unshift(`${node.localName}:nth-of-type(${Math.max(1, position)})`);
    node = node.parentElement;
  }
  return path.join(' > ') || null;
}

function captureFocusedElement(root) {
  const element = document.activeElement;
  if (!(element instanceof HTMLElement) || !root.contains(element)) return null;
  const selector = uniqueSelector(element, root);
  if (!selector) return null;
  const snapshot = { selector };
  if (element.matches('input, textarea, select')) snapshot.value = element.value;
  if (element.matches('input[type="checkbox"], input[type="radio"]')) snapshot.checked = element.checked;
  if ('selectionStart' in element && typeof element.selectionStart === 'number') {
    snapshot.selectionStart = element.selectionStart;
    snapshot.selectionEnd = element.selectionEnd;
  }
  return snapshot;
}

function captureDrafts(root) {
  const drafts = [];
  root.querySelectorAll(DRAFT_SELECTOR).forEach((element) => {
    const selector = uniqueSelector(element, root);
    if (selector) drafts.push({ selector, value: element.value });
  });
  return drafts;
}

function captureDetails(root) {
  return [...root.querySelectorAll('details')]
    .map((element) => ({ selector: uniqueSelector(element, root), open: element.open }))
    .filter(({ selector }) => Boolean(selector));
}

export function captureViewRenderState(root) {
  return {
    scrollTop: root.scrollTop,
    focus: captureFocusedElement(root),
    drafts: captureDrafts(root),
    details: captureDetails(root),
  };
}

function find(root, selector) {
  try {
    return root.querySelector(selector);
  } catch {
    return null;
  }
}

export function restoreViewRenderState(root, snapshot) {
  if (!snapshot) return;

  snapshot.details.forEach(({ selector, open }) => {
    const details = find(root, selector);
    if (details instanceof HTMLDetailsElement) details.open = open;
  });

  snapshot.drafts.forEach(({ selector, value }) => {
    const input = find(root, selector);
    if (input?.matches?.(DRAFT_SELECTOR)) input.value = value;
  });

  const focused = snapshot.focus && find(root, snapshot.focus.selector);
  if (focused instanceof HTMLElement) {
    if ('value' in snapshot.focus && focused.matches('input, textarea, select')) focused.value = snapshot.focus.value;
    if ('checked' in snapshot.focus && focused.matches('input[type="checkbox"], input[type="radio"]')) focused.checked = snapshot.focus.checked;
    focused.focus({ preventScroll: true });
    if (
      typeof snapshot.focus.selectionStart === 'number' &&
      'setSelectionRange' in focused
    ) {
      focused.setSelectionRange(snapshot.focus.selectionStart, snapshot.focus.selectionEnd);
    }
  }

  // Restore after focus: searchable pickers expand on focus and can increase
  // the scroll height. Assigning before that expansion lets the browser clamp
  // a valid old position to the temporarily shorter closed-view maximum.
  root.scrollTop = snapshot.scrollTop;
}
