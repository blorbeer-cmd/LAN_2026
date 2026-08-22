const euroFormatter = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

export function formatEuroCents(cents) {
  return euroFormatter.format(cents / 100);
}

// A bare PayPal.me URL accepts an amount in its path. Other URLs are left
// untouched so callers never rewrite a destination they did not create.
export function paypalPayUrl(paypalLink, cents) {
  const bareMatch = (paypalLink ?? '').match(
    /^https?:\/\/(?:www\.)?(?:paypal\.me\/([^/?#]+)|paypal\.com\/paypalme\/([^/?#]+))\/?$/i,
  );
  if (bareMatch && cents > 0) {
    return `https://paypal.me/${bareMatch[1] ?? bareMatch[2]}/${(cents / 100).toFixed(2)}EUR`;
  }
  return paypalLink;
}

const PAYPAL_EMAIL_LINK_RE = /^https:\/\/www\.paypal\.com\/myaccount\/transfer\/homepage\/pay\?recipient=([^&]+)$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAYPAL_HOSTS = new Set(['paypal.me', 'www.paypal.me', 'paypal.com', 'www.paypal.com']);

function isAllowedPaypalUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !PAYPAL_HOSTS.has(host) || url.username || url.password) return false;
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
  } catch {
    return false;
  }
}

export function paypalEmailFromLink(paypalLink) {
  const match = (paypalLink ?? '').match(PAYPAL_EMAIL_LINK_RE);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

// Accepts the same convenient inputs in every PayPal-enabled form. Callers
// that require a prefilled amount can additionally require paypalPayUrl() to
// return a different URL for a positive test amount.
export function normalizePaypalInput(raw) {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const insecurePaypalMe = trimmed.match(/^http:\/\/((?:www\.)?paypal\.me\/.*)$/i);
  const urlCandidate = insecurePaypalMe ? `https://${insecurePaypalMe[1]}` : trimmed;
  if (/^https?:\/\//i.test(urlCandidate)) {
    if (isAllowedPaypalUrl(urlCandidate)) return urlCandidate;
    throw new Error('PayPal-Link muss HTTPS verwenden und zu paypal.me oder paypal.com führen.');
  }
  if (EMAIL_RE.test(trimmed)) {
    return `https://www.paypal.com/myaccount/transfer/homepage/pay?recipient=${encodeURIComponent(trimmed)}`;
  }
  const name = trimmed
    .replace(/^@/, '')
    .replace(/^(www\.)?paypal\.me\//i, '')
    .replace(/\/+$/, '');
  if (!name || /[\s/?#]/.test(name)) {
    throw new Error('PayPal-Link muss eine gültige URL, E-Mail-Adresse oder ein PayPal.me-Name ohne Leerzeichen sein.');
  }
  return `https://paypal.me/${name}`;
}
