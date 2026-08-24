export type EventParticipationStatus = 'invited' | 'accepted' | 'declined';

// Every direct SQL consumer aliases event_participants as `ep` and reuses
// this condition. That keeps invited/declined rows from drifting into normal
// participant delivery through subtly different existence checks.
// Abstimmungen never invalidate an accepted event invitation. The retained
// schedule-revision columns are migration compatibility only and deliberately
// do not participate in workspace visibility or poll eligibility.
export const ACCEPTED_EVENT_PARTICIPANT_SQL = "ep.status = 'accepted'";
