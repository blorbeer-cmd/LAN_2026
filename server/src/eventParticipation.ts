export type EventParticipationStatus = 'invited' | 'accepted' | 'declined';

// Every direct SQL consumer aliases event_participants as `ep` and reuses
// this condition. That keeps invited/declined rows from drifting into normal
// participant delivery through subtly different existence checks.
export const ACCEPTED_EVENT_PARTICIPANT_SQL = "ep.status = 'accepted'";
