export interface PoolTip {
  id: string;
  outcomeId: string;
  stake: number;
  createdAt: number;
  sequence: number;
}

export type BettingPayoutPolicy = 'pool_v1' | 'stake_cap_v1';

// Largest-remainder allocation. Earlier submissions settle equal remainders;
// the persisted sequence distinguishes submissions in the same millisecond.
// Stable tip IDs are the final fallback. No points are
// minted or discarded, including pools whose shares are fractional.
function allocate(amount: number, tips: PoolTip[]): Map<string, number> {
  const stakes = tips.reduce((sum, tip) => sum + tip.stake, 0);
  const shares = tips
    .map((tip) => ({
      tip,
      whole: Math.floor((amount * tip.stake) / stakes),
      remainder: (amount * tip.stake) % stakes,
    }))
    .sort((a, b) => b.remainder - a.remainder || a.tip.createdAt - b.tip.createdAt ||
      a.tip.sequence - b.tip.sequence || a.tip.id.localeCompare(b.tip.id, 'en'));
  const remainder = amount - shares.reduce((sum, share) => sum + share.whole, 0);
  return new Map(shares.map((share, index) => [share.tip.id, share.whole + (index < remainder ? 1 : 0)]));
}

export function distributePool(
  tips: PoolTip[], winner: string | null, policy: BettingPayoutPolicy = 'stake_cap_v1',
): Map<string, number> {
  const payouts = new Map(tips.map((tip) => [tip.id, tip.stake]));
  const winners = tips.filter((tip) => tip.outcomeId === winner);
  const losers = tips.filter((tip) => tip.outcomeId !== winner);
  if (!winner || !winners.length || !losers.length) return payouts;
  const winningStakes = winners.reduce((sum, tip) => sum + tip.stake, 0);
  const losingStakes = losers.reduce((sum, tip) => sum + tip.stake, 0);
  if (policy === 'pool_v1') {
    // Historical paid markets keep their original rule during corrections.
    for (const tip of losers) payouts.set(tip.id, 0);
    for (const [id, payout] of allocate(winningStakes + losingStakes, winners)) payouts.set(id, payout);
    return payouts;
  }
  // Only the smaller side's total changes hands. Allocate gains and losses
  // independently so rounding preserves both the cap and the exact zero sum.
  const transferred = Math.min(winningStakes, losingStakes);
  const gains = allocate(transferred, winners);
  const losses = allocate(transferred, losers);
  for (const tip of winners) payouts.set(tip.id, tip.stake + gains.get(tip.id)!);
  for (const tip of losers) payouts.set(tip.id, tip.stake - losses.get(tip.id)!);
  return payouts;
}
