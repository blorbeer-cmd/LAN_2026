// Initial profile color for a new account. A fixed default made most people
// share one blue until they changed it, so a new account gets a random hue
// instead. Of a few random candidates the one farthest from the hues already
// in use wins, so colors repeat rarely even though nobody coordinates them.
// Saturation stays in a band that reads well on the dark theme; brightness is
// full, matching the profile color wheel (hue and saturation only).

import { db } from './db';

const CANDIDATE_COUNT = 36;
const MIN_SATURATION = 0.55;
const MAX_SATURATION = 0.85;

function hsvToHex(hue: number, saturation: number): string {
  const section = hue / 60;
  const secondary = saturation * (1 - Math.abs((section % 2) - 1));
  const [red, green, blue] =
    section < 1 ? [saturation, secondary, 0]
      : section < 2 ? [secondary, saturation, 0]
        : section < 3 ? [0, saturation, secondary]
          : section < 4 ? [0, secondary, saturation]
            : section < 5 ? [secondary, 0, saturation]
              : [saturation, 0, secondary];
  const match = 1 - saturation;
  return `#${[red, green, blue]
    .map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

// Hue in degrees, or null for a gray without a meaningful hue.
function hueOf(hex: string): number | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return null;
  const [red, green, blue] = [0, 2, 4].map((offset) => parseInt(match[1].slice(offset, offset + 2), 16) / 255);
  const max = Math.max(red, green, blue);
  const delta = max - Math.min(red, green, blue);
  if (delta === 0) return null;
  let hue: number;
  if (max === red) hue = 60 * (((green - blue) / delta) % 6);
  else if (max === green) hue = 60 * ((blue - red) / delta + 2);
  else hue = 60 * ((red - green) / delta + 4);
  return (hue + 360) % 360;
}

function hueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

export function pickPlayerColor(existingColors: readonly string[], random: () => number = Math.random): string {
  const usedHues = existingColors.map(hueOf).filter((hue): hue is number => hue !== null);
  let best = { color: '', distance: -1 };
  for (let i = 0; i < CANDIDATE_COUNT; i += 1) {
    const hue = random() * 360;
    const saturation = MIN_SATURATION + random() * (MAX_SATURATION - MIN_SATURATION);
    const distance = usedHues.length === 0 ? 360 : Math.min(...usedHues.map((used) => hueDistance(hue, used)));
    if (distance > best.distance) best = { color: hsvToHex(hue, saturation), distance };
  }
  return best.color;
}

export function initialPlayerColor(): string {
  const rows = db.prepare('SELECT color FROM players WHERE deactivated_at IS NULL').all() as { color: string }[];
  return pickPlayerColor(rows.map((row) => row.color));
}
