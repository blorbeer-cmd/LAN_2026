// Food orders receive frequent realtime updates while users type, expand
// cards and work through payment toggles. This extends the generic view-state
// contract with stable order-card anchors and the three-field item drafts.

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function visibleOrderViewportAnchors(container) {
  const viewport = container.getBoundingClientRect();
  return [...container.querySelectorAll('[data-order-card], [data-closed-order]')]
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        id: element.dataset.orderCard ?? element.dataset.closedOrder,
        offset: rect.top - viewport.top,
        visible: rect.bottom > viewport.top && rect.top < viewport.bottom,
      };
    })
    .filter((anchor) => anchor.id && anchor.visible)
    .sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset));
}

function visibleFocusTargets(scope) {
  return [...scope.querySelectorAll(FOCUSABLE_SELECTOR)].filter(
    (element) => !element.closest('[hidden]') && element.getClientRects().length > 0,
  );
}

function focusScope(container, element) {
  const card = element.closest('[data-order-card], [data-closed-order]');
  if (!card || !container.contains(card)) return { kind: 'view', id: null, element: container };
  if (card.dataset.orderCard) return { kind: 'open', id: card.dataset.orderCard, element: card };
  return { kind: 'closed', id: card.dataset.closedOrder, element: card };
}

function captureFocus(container) {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !container.contains(active)) return null;
  const scope = focusScope(container, active);
  const attributes = [...active.attributes]
    .filter(
      ({ name }) =>
        name === 'id' ||
        name === 'class' ||
        name === 'name' ||
        name === 'type' ||
        name === 'href' ||
        name === 'aria-label' ||
        (name.startsWith('data-') && !name.startsWith('data-e2e-')),
    )
    .map(({ name, value }) => [name, value]);
  const targets = visibleFocusTargets(scope.element);
  return {
    scopeKind: scope.kind,
    scopeId: scope.id,
    tagName: active.tagName,
    attributes,
    text: active.textContent?.trim() ?? '',
    index: targets.indexOf(active),
  };
}

function captureDrafts(container) {
  const drafts = new Map();
  container.querySelectorAll('[data-add-item-form]').forEach((form) => {
    const desc = form.querySelector('[data-item-desc]');
    const quantity = form.querySelector('[data-item-quantity]');
    const price = form.querySelector('[data-item-price]');
    drafts.set(form.dataset.addItemForm, {
      desc: desc?.value ?? '',
      quantity: quantity?.value ?? '',
      price: price?.value ?? '',
      focus:
        document.activeElement === desc
          ? 'desc'
          : document.activeElement === quantity
            ? 'quantity'
            : document.activeElement === price
              ? 'price'
              : null,
    });
  });
  return drafts;
}

export function captureFoodOrderViewState(container) {
  return {
    scrollTop: container.scrollTop,
    viewportAnchors: visibleOrderViewportAnchors(container),
    focus: captureFocus(container),
    drafts: captureDrafts(container),
  };
}

export function restoreFoodOrderViewport(container, snapshot) {
  container.scrollTop = snapshot.scrollTop;
  const viewportTop = container.getBoundingClientRect().top;
  const cards = [...container.querySelectorAll('[data-order-card], [data-closed-order]')];
  for (const anchor of snapshot.viewportAnchors) {
    const element = cards.find((card) => (card.dataset.orderCard ?? card.dataset.closedOrder) === anchor.id);
    if (!element || element.getClientRects().length === 0) continue;
    container.scrollTop += element.getBoundingClientRect().top - viewportTop - anchor.offset;
    return;
  }
}

export function restoreFoodOrderDrafts(container, snapshot) {
  container.querySelectorAll('[data-add-item-form]').forEach((form) => {
    const draft = snapshot.drafts.get(form.dataset.addItemForm);
    if (!draft) return;
    const desc = form.querySelector('[data-item-desc]');
    const quantity = form.querySelector('[data-item-quantity]');
    const price = form.querySelector('[data-item-price]');
    if (draft.desc) desc.value = draft.desc;
    quantity.value = draft.quantity;
    if (draft.price) price.value = draft.price;
    if (draft.focus === 'desc') desc.focus({ preventScroll: true });
    if (draft.focus === 'quantity') quantity.focus({ preventScroll: true });
    if (draft.focus === 'price') price.focus({ preventScroll: true });
  });
}

export function restoreFoodOrderFocus(container, snapshot) {
  const anchor = snapshot.focus;
  if (!anchor) return;
  const scope =
    anchor.scopeKind === 'view'
      ? container
      : [...container.querySelectorAll('[data-order-card], [data-closed-order]')].find((card) =>
          anchor.scopeKind === 'open'
            ? card.dataset.orderCard === anchor.scopeId
            : card.dataset.closedOrder === anchor.scopeId,
        );
  if (!scope) return;
  const targets = visibleFocusTargets(scope);
  let target = targets.find(
    (element) =>
      element.tagName === anchor.tagName &&
      anchor.attributes.every(([name, value]) => element.getAttribute(name) === value),
  );
  if (!target && anchor.attributes.length === 0) {
    const indexedTarget = targets[anchor.index];
    if (indexedTarget?.tagName === anchor.tagName && indexedTarget.textContent?.trim() === anchor.text) {
      target = indexedTarget;
    }
  }
  target?.focus({ preventScroll: true });
}
