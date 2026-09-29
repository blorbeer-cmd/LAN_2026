// Placement matches (all places played out) share the knockout's rounds with
// the main bracket. Knockout matches carry placeFrom: 1 for the main bracket,
// a higher place for a placement bracket, whose placeRange names the real
// places it decides. Kept DOM-free so the kiosk can use it, too.

export const isMainBracketMatch = (match) => (match.placeFrom ?? 1) === 1;

// „Spiel um Platz 3“ for a match that decides two places directly,
// „Platz 5–8“ for an earlier round of a larger placement bracket.
export function placementMatchLabel(match, totalRounds) {
  const { from, to } = match.placeRange ?? {};
  if (!from) return '';
  return match.round === totalRounds || to - from <= 1 ? `Spiel um Platz ${from}` : `Platz ${from}–${to}`;
}
