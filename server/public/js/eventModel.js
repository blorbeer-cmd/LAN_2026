// Pure event participation and payment calculations shared by event cards,
// tests and future summary surfaces.

export function acceptedParticipants(event, players = []) {
  if (Array.isArray(event.acceptedParticipants)) return event.acceptedParticipants;
  const acceptedIds = new Set(
    event.participantIds ??
      (event.participants ?? [])
        .filter((participant) => participant.status === 'accepted')
        .map((participant) => participant.playerId),
  );
  const paidById = new Map(
    (event.participants ?? []).map((participant) => [participant.playerId, Boolean(participant.paid)]),
  );
  return players
    .filter((player) => acceptedIds.has(player.id))
    .map((player) => ({ playerId: player.id, name: player.name, paid: paidById.get(player.id) ?? false }));
}

export function acceptedParticipantCount(event, players = []) {
  return acceptedParticipants(event, players).length;
}

export function eventSettlement(event, players = []) {
  const participants = acceptedParticipants(event, players);
  const contributionCents = event.costCents ?? 0;
  const currentPaidParticipants = participants.filter((participant) => participant.paid);
  const paidCents =
    event.settlementPaidCents ??
    currentPaidParticipants.reduce((sum, participant) => sum + (participant.paidAmountCents ?? 0), 0);
  const paidCount = event.settlementPaidCount ?? currentPaidParticipants.length;
  const unpaidCount = participants.length - currentPaidParticipants.length;
  const expectedCents = paidCents + unpaidCount * contributionCents;
  const accommodationCents = event.accommodationCostCents ?? null;
  return {
    participantCount: participants.length,
    paidCount,
    unpaidCount,
    paidCents,
    missingAmountCount: event.settlementMissingAmountCount ?? 0,
    expectedCents,
    accommodationCents,
    perHeadCents:
      accommodationCents !== null && participants.length > 0
        ? Math.round(accommodationCents / participants.length)
        : null,
    balanceCents: accommodationCents === null ? null : paidCents - accommodationCents,
    expectedBalanceCents: accommodationCents === null ? null : expectedCents - accommodationCents,
  };
}

function parseEventEuroCents(raw, maxEuro) {
  const trimmed = (raw ?? '').trim().replace('€', '').trim();
  if (!trimmed) return null;
  let normalized;
  if (trimmed.includes(',')) {
    if (!/^\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?$|^\d+(?:,\d{1,2})?$/.test(trimmed)) return NaN;
    normalized = trimmed.replaceAll('.', '').replace(',', '.');
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(trimmed)) {
    normalized = trimmed.replaceAll('.', '');
  } else if (/^\d+(?:\.\d{1,2})?$/.test(trimmed)) {
    normalized = trimmed;
  } else {
    return NaN;
  }
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0 || value > maxEuro) return NaN;
  return Math.round(value * 100);
}

export function parseEventCostCents(raw) {
  return parseEventEuroCents(raw, 10_000);
}

export function parseEventAccommodationCostCents(raw) {
  return parseEventEuroCents(raw, 100_000);
}

export function eventPdfExportAvailable(event) {
  // The keepsake summarizes LAN-only competition and tracking data. Older
  // event payloads without a type stay LAN-compatible.
  return event?.eventType !== 'general';
}
