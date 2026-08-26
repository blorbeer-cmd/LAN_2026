// Pure food-order calculations. Keeping these out of the view makes the
// pricing/payment contract independently testable and leaves rendering and
// network actions in views/foodOrders.js.

// "4,50" / "4.50" / "4" -> 450 cents; null for empty, NaN for garbage.
export function parsePriceToCents(raw) {
  const trimmed = (raw || '').trim().replace('€', '').trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(',', '.');
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return NaN;
  return Math.round(value * 100);
}

export function addTipToCents(cents, tipPercent) {
  return Math.round(cents * (1 + (tipPercent || 0) / 100));
}

export function groupPaymentState(items) {
  return items.length > 0 && items.every((item) => item.paid) ? 'paid' : 'open';
}

function normalizeDescription(description) {
  return description.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function foodOrderDescriptionSuggestions(items) {
  const seen = new Map();
  for (const item of items) {
    const normalized = normalizeDescription(item.description);
    if (!seen.has(normalized)) {
      seen.set(normalized, {
        label: item.description.trim().replace(/\s+/g, ' '),
        priceCents: item.priceCents ?? null,
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, 'de'));
}

// Same normalized description at a different unit price deliberately remains
// a separate row; merging it would silently change the consolidated total.
export function buildConsolidatedRows(items) {
  const rows = new Map();
  for (const item of items) {
    const normalized = normalizeDescription(item.description);
    const key = `${normalized}|${item.priceCents === null ? 'null' : item.priceCents}`;
    if (!rows.has(key)) {
      rows.set(key, {
        description: item.description.trim().replace(/\s+/g, ' '),
        priceCents: item.priceCents,
        quantity: 0,
      });
    }
    rows.get(key).quantity += item.quantity ?? 1;
  }
  return [...rows.values()].sort((a, b) => a.description.localeCompare(b.description, 'de'));
}
