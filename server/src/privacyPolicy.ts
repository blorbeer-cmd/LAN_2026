export const TRACKING_CONSENT_PURPOSE = 'event_game_activity';
export const TRACKING_CONSENT_TEXT_VERSION = '2026-09-19.1';
export const TRACKING_CONSENT_TEXT =
  'Ich willige ein, dass Respawn für das ausgewählte laufende Event erkannte Spiele aus der veröffentlichten Spieleliste, Vordergrund-/Leerlaufstatus und daraus abgeleitete Spielzeit verarbeitet. Andere Programme, Fenstertitel und Dateien werden nicht erfasst. Die Einwilligung ist freiwillig und kann jederzeit im Profil mit Wirkung für die Zukunft widerrufen werden.';

export const GROUP_TRACKING_CONSENT_PURPOSE = 'group_game_activity_outside_events';
export const GROUP_TRACKING_CONSENT_TEXT_VERSION = '2026-09-19.1';
export const GROUP_TRACKING_CONSENT_TEXT =
  'Ich willige ein, dass Respawn erkannte Spiele aus der veröffentlichten Spieleliste für den Live-Status der dauerhaften Gruppe verarbeitet, wenn kein eigenes Event ausgewählt ist. Die Einwilligung ist freiwillig und jederzeit widerrufbar.';

export interface ConsentMetadata {
  purpose: string;
  textVersion: string;
}
