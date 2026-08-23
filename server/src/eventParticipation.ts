export type EventParticipationStatus = 'invited' | 'interested' | 'accepted' | 'declined';

// Every direct SQL consumer aliases event_participants as `ep` and reuses
// this condition. That keeps invited/declined rows from drifting into normal
// participant delivery through subtly different existence checks.
//
// A schedule revision was added for the event date poll: rescheduling an
// event (event_date_polls choosing a new option) bumps events.schedule_revision
// without touching the roster. An "accepted" row from a previous revision is
// therefore only a CURRENT, confirmed participation once its own
// confirmed_schedule_revision (set at the moment of accept/decline, see
// events.ts) matches the event's current revision — otherwise the person
// needs to reconfirm before they count for pricing, tracking, headcounts,
// active-workspace selection or anywhere else this predicate is used. The
// scalar subquery (rather than requiring an `events` join at every call site)
// is what lets every existing consumer opt in without restructuring its FROM
// clause.
export const ACCEPTED_EVENT_PARTICIPANT_SQL =
  "ep.status = 'accepted' AND ep.confirmed_schedule_revision = (SELECT e_rev.schedule_revision FROM events e_rev WHERE e_rev.id = ep.event_id)";
