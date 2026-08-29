export async function copyText(value, {
  navigatorRef = globalThis.navigator,
  documentRef = globalThis.document,
} = {}) {
  try {
    if (navigatorRef?.clipboard?.writeText) {
      await navigatorRef.clipboard.writeText(value);
      return;
    }
  } catch {
    // Browsers can expose Clipboard but still reject it on an HTTP LAN URL.
    // Fall through to the selection-based copy path below.
  }

  if (!documentRef?.body || typeof documentRef.createElement !== 'function') {
    throw new Error('Copy failed');
  }

  const field = documentRef.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.inset = '0';
  field.style.opacity = '0';
  documentRef.body.appendChild(field);
  try {
    field.select();
    field.setSelectionRange(0, value.length);
    if (!documentRef.execCommand?.('copy')) throw new Error('Copy failed');
  } finally {
    field.remove();
  }
}
