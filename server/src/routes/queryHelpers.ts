// Shared query-string parsing for the analytics endpoints' day/time filter
// (?from=&to=, both epoch ms).

export function parseTimeRangeQuery(query: Record<string, unknown>): { from?: number; to?: number } | { error: string } {
  const { from, to } = query;
  let parsedFrom: number | undefined;
  let parsedTo: number | undefined;

  if (from !== undefined) {
    if (typeof from !== 'string' || !/^\d+$/.test(from)) {
      return { error: 'from muss ein Zeitstempel (ms) sein.' };
    }
    parsedFrom = parseInt(from, 10);
  }
  if (to !== undefined) {
    if (typeof to !== 'string' || !/^\d+$/.test(to)) {
      return { error: 'to muss ein Zeitstempel (ms) sein.' };
    }
    parsedTo = parseInt(to, 10);
  }
  if (parsedFrom !== undefined && parsedTo !== undefined && parsedFrom > parsedTo) {
    return { error: 'from darf nicht nach to liegen.' };
  }

  return { from: parsedFrom, to: parsedTo };
}
