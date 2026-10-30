export interface PoolTip {
  id: string;
  outcomeId: string;
  stake: number;
}

// Largest-remainder allocation. Stable tip IDs settle ties; no points are
// minted or discarded, including pools whose shares are fractional.
export function distributePool(tips: PoolTip[], winner: string | null): Map<string, number> {
  const payouts = new Map(tips.map((tip) => [tip.id, tip.stake]));
  const winners = tips.filter((tip) => tip.outcomeId === winner);
  if (!winner || !winners.length || new Set(tips.map((tip) => tip.outcomeId)).size < 2) return payouts;
  const pot = tips.reduce((sum, tip) => sum + tip.stake, 0);
  const winningStakes = winners.reduce((sum, tip) => sum + tip.stake, 0);
  for (const tip of tips) payouts.set(tip.id, 0);
  const shares = winners
    .map((tip) => ({
      tip,
      whole: Math.floor((pot * tip.stake) / winningStakes),
      remainder: (pot * tip.stake) % winningStakes,
    }))
    .sort((a, b) => b.remainder - a.remainder || a.tip.id.localeCompare(b.tip.id, 'en'));
  const remainder = pot - shares.reduce((sum, share) => sum + share.whole, 0);
  shares.forEach((share, index) => payouts.set(share.tip.id, share.whole + (index < remainder ? 1 : 0)));
  return payouts;
}
