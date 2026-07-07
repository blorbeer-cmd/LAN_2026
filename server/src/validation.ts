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

// Profile pictures are stored inline as data: URLs (no separate file storage
// needed for ~15 people). Capped well above what a client-side-resized
// thumbnail needs, to keep the SQLite file small.
const MAX_AVATAR_LENGTH = 400_000;
const AVATAR_RE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/;

export function isValidAvatar(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_AVATAR_LENGTH && AVATAR_RE.test(value);
}
