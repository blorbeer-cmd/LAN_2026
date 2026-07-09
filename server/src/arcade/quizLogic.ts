export function normalizeAnswer(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function matchesAnswer(input: string, accepted: string[]): boolean {
  const normalized = normalizeAnswer(input);
  if (!normalized) return false;
  return accepted.some((answer) => normalizeAnswer(answer) === normalized);
}

export function pickQuestion(candidateIds: string[], seenByBoth: Set<string>): string | null {
  if (candidateIds.length === 0) return null;
  const fresh = candidateIds.filter((id) => !seenByBoth.has(id));
  const pool = fresh.length ? fresh : candidateIds;
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}
