// Small validation helpers shared by route handlers. Kept dependency-free and
// synchronous to match the rest of this codebase.

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isNonEmptyString(value: unknown, maxLength = 60): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength;
}

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_RE.test(value);
}

export function isIntInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

// Links to a menu/delivery service (food orders' "Link zu Karte/Lieferdienst").
// Only http(s) is accepted — this gets rendered as a clickable link, so
// javascript: and similar schemes must never pass.
const HTTP_URL_RE = /^https?:\/\//i;

export function isValidUrl(value: unknown, maxLength = 300): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength || !HTTP_URL_RE.test(trimmed)) return false;
  try {
    new URL(trimmed);
    return true;
  } catch {
    return false;
  }
}

const PAYPAL_HOSTS = new Set(['paypal.me', 'www.paypal.me', 'paypal.com', 'www.paypal.com']);

function isBarePaypalMeDestination(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  try {
    const pathname = decodeURIComponent(url.pathname);
    if (host === 'paypal.me' || host === 'www.paypal.me') {
      if (url.search || url.hash) return false;
      return /^\/[^/]+\/?$/.test(pathname);
    }
    if (host === 'paypal.com' || host === 'www.paypal.com') {
      if (/^\/paypalme(?:\/|$)/i.test(pathname)) {
        if (url.search || url.hash) return false;
        return /^\/paypalme\/[^/]+\/?$/i.test(pathname);
      }
    }
    return true;
  } catch {
    return false;
  }
}

// Payment destinations are more sensitive than ordinary menu/location links:
// keep them encrypted and on a PayPal-owned host. This validator is shared by
// Events and food orders so both payment flows enforce the same API boundary.
export function isValidPaypalUrl(value: unknown, maxLength = 300): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return false;
  try {
    const url = new URL(trimmed);
    return (
      url.protocol === 'https:' &&
      PAYPAL_HOSTS.has(url.hostname.toLowerCase()) &&
      url.username === '' &&
      url.password === '' &&
      isBarePaypalMeDestination(url)
    );
  } catch {
    return false;
  }
}

// Profile pictures are stored inline as data: URLs (no separate file storage
// needed for ~15 people). Capped well above what a client-side-resized
// thumbnail needs, to keep the SQLite file small.
const MAX_AVATAR_LENGTH = 400_000;
const AVATAR_RE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/;

export function isValidAvatar(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_AVATAR_LENGTH && AVATAR_RE.test(value);
}
