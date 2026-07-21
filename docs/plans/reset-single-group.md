# Reset-Plan: Eine Gruppe pro Instanz

Stand: 2026-07-21 · Status: **Umsetzung abgeschlossen — R0 bis R5 erledigt**

Produktentscheidung: **Eine Instanz bedient genau eine Freundesgruppe.** Events bleiben als
eigenständige Entität (zeitlich begrenzte Unterräume mit Teilnehmerliste, Tracking-Zeitfenster und
eventbezogenen Daten). Das Mehrgruppenmodell aus `docs/KONZEPT-USER-MANAGEMENT.md` Rev. 4 wird
nicht weiterverfolgt; ein zweiter Freundeskreis bekommt ein eigenes Deployment.

Dieser Plan ersetzt die neun offenen Fix-Phasen des Multi-Gruppen-Reviews durch einen gezielten
Rückschnitt. Er wurde gegen den tatsächlichen Code auf `main` (`622f54e`) und den Fix-Branch von
PR #238 (`9379aeb`) vermessen, nicht nur gegen die Dokumente.

---

## 1. Zielbild

Nach dem Reset gilt:

1. Es existiert genau eine Gruppe: die bei der Migration erzeugte Startgruppe
   (`DEFAULT_GROUP_ID`). Sie ist ein internes Implementierungsdetail, kein Bedienkonzept.
2. Es gibt keine Benutzeroberfläche und keine API mehr, um weitere Gruppen zu erzeugen, ihnen
   beizutreten, sie zu verlassen oder zu archivieren.
3. Events bleiben vollständig erhalten: Anlage, Zeitraum, Teilnehmerliste, Event-Tracking-Consent,
   eventbezogene Realtime-/Push-/Kiosk-Scopes und Event-Auswertungen.
4. Das Auth-Fundament aus PR #197 (Phasen 1–4: Konten, Sessions, Passwort-Härtung, Required-Mode,
   Step-up-Reauth) bleibt unverändert bestehen.
5. Die Rollen `owner`/`admin`/`member` der Startgruppe bleiben als Rechtemodell bestehen (sie sind
   in ~30 Routen-Dateien über `requireGroupRole` verdrahtet und getestet); nur die
   Mehrgruppen-Verwaltung darüber entfällt.
6. Kein Datenverlust: keine destruktive Schemamigration im Reset.

## 2. Grundsatzentscheidung: Stilllegen statt Rückbau

Die `group_id`-Spalten, die Tabellen `groups`/`group_memberships` und die zentralen Resolver
bleiben im Schema und im Code bestehen — mit konstant genau einer Gruppe.

Begründung:

- `group_memberships` wird von 20 Nicht-Test-Dateien referenziert, `db.ts` allein 31-mal. Ein
  echter Spalten-/Tabellen-Rückbau wäre eine neue XL-Migration mit eigenem Datenverlust-Risiko —
  genau die Art Großumbau, die uns in diese Lage gebracht hat.
- Eine `group_id`-Spalte mit konstant einem Wert kostet nichts: kein Filter kann „vergessen“
  werden, wenn es nur einen möglichen Wert gibt. Die Multi-Tenant-Gefahr entsteht durch die
  *zweite* Gruppe, nicht durch die Spalte.
- Der von PR #238 gehärtete Zustellungscode (Realtime/Kiosk/Arcade) ist korrekt, getestet und für
  den Ein-Gruppen-Betrieb identisch gültig. Er wird behalten, nicht zurückgebaut.

Ein späterer harter Schema-Rückbau bleibt möglich (Abschnitt 8), wird aber ausdrücklich **nicht**
empfohlen.

## 3. Was bleibt, was entfällt

| Bereich | Entscheidung |
|---|---|
| Konten, Sessions, Passwort-Härtung, Required-Mode (Phasen 1–4) | bleibt unverändert |
| Events, `event_participants`, Event-Tracking-Consent, Event-Zeitfenster | bleibt unverändert |
| Rollen `owner`/`admin`/`member` in der Startgruppe | bleibt (eingefroren als Instanz-Rechtemodell) |
| Kiosk-Tokens (Gruppen-/Event-Scope), `/groups/:groupId/kiosk-tokens` | bleibt (auf Startgruppe gepinnt) |
| Tracking-Consent-Endpunkte, Mitgliederliste, Audit, Test-User unter `/groups/:groupId/…` | bleibt (auf Startgruppe gepinnt) |
| Realtime-Zustellmodell inkl. Event-Scoping aus PR #238 | bleibt |
| `MULTI_GROUPS_ENABLED`-Flag (`config.ts:67`) | entfällt ersatzlos |
| `POST /api/groups`, `GET/POST /api/groups/invites/:code(/accept)` (`routes/groups.ts:87,114,132`) | entfällt |
| `POST /:groupId/leave`, Gruppe archivieren/löschen (`routes/groups.ts:226,318`) | entfällt |
| Gruppenumschalter, „Gruppe anlegen/verlassen/archivieren“, Einladungslink-UI (`public/js/groupContext.js`) | entfällt; Datei schrumpft auf Kontextanzeige oder verschwindet |
| `x-group-id`-Header im Client (`public/js/api.js`) | Client sendet ihn nicht mehr; Server akzeptiert ihn übergangsweise und ignoriert fremde Werte mit 404 wie bisher |
| Konzept Rev. 4 (Mehrgruppen) | wird durch Rev. 5 (Ein-Gruppen-Modell) ersetzt |
| Neun geplante Multi-Gruppen-Fix-Phasen | entfallen; Rest siehe Finding-Mapping |

## 4. Auswirkung auf die offenen Review-Findings

| Finding | Nach Reset | Begründung |
|---|---|---|
| F1 Arcade/Watch nur client-kooperativ | **erledigt durch #238** und zusätzlich strukturell entschärft (keine zweite Gruppe) | Default-deny + unveränderliche Scopes sind gemergt zu übernehmen |
| F2 Arrivals/Food-Orders ohne Gruppenscope | **erledigt durch #238**; Restrisiko entfällt strukturell | gruppenlokale Event-Auflösung bleibt für Events nötig und ist umgesetzt |
| F3 `broadcast()` verwirft ungescopte Events | **erledigt durch #238** (Pflicht-Scope, alle Aufrufer versorgt) | gruppenunabhängiger Bug, Fix bleibt |
| F4 Kiosk/Legacy erhalten nichts | **erledigt durch #238** | gruppenunabhängiger Bug, Fix bleibt |
| F5 „erste Mitgliedschaft“-Ableitung | **obsolet** | mit einer Gruppe ist die Ableitung immer korrekt; #238 hat sie zudem ersetzt |
| F6 Event-Teilnahme ohne Zustände/Einladungsprüfung | **erledigt durch [PR #264](https://github.com/blorbeer-cmd/LAN_2026/pull/264)** | `invited`/`accepted`/`declined` sind umgesetzt; nur `accepted` zählt als normale Teilnahme |
| F7 Migrationen in Registrierungs- statt Versionsreihenfolge | **bleibt** (Phase R4) | gruppenunabhängige Wartungsschuld (`db.ts:663 ff.`, v44 vor v41–43 registriert) |
| F8 Tabellen außerhalb des Migrationszählers, unguarded `ALTER` | **bleibt** (Phase R4) | gruppenunabhängig (`db.ts:2561,2588`) |
| F9 globales `getTrackingEventId()` | **obsolet als Sicherheitsthema** | mit einer Gruppe ist „das eine Tracking-Event“ wieder wohldefiniert; #238 nutzt ohnehin schon die gruppenlokale Auflösung |
| F10 Arcade-Ergebnis-Scope global | **obsolet** (eine Gruppe) · #238 übergibt zudem den unveränderlichen Match-Scope | — |
| F11 Arcade-Pushes → Default-Gruppe | **obsolet** — Default-Gruppe ist jetzt per Definition richtig | — |
| F12 Offline-Sweep nur Startgruppe | **obsolet** — es gibt nur die Startgruppe; #238-Fanout schadet nicht | — |
| F13 Consent-Abweichungen §7.3/§7.4 | **in Umsetzung auf `codex/f13-tracking-consent` (P3)** | Rev. 5 §§5.1–5.3 trennt Gruppenraum- und Event-Consent; privates Event-Tracking verlangt `accepted` + Consent, Widerrufe wirken idempotent und sofort |
| F14 Testmatrix unvollständig | **schrumpft** | Cross-Group-Matrix entfällt mit der API; Event-Matrix (Teilnehmer/Nichtteilnehmer/Admin, Kiosk, Widerruf) existiert seit #238 |
| F15 Changelog-Lücken ab PR #214 | **bleibt** (Phase R5) | Doku-Hygiene, unabhängig vom Modell |
| F16 Prozessverstöße | **bleibt als Arbeitsregel** | Direkt-Pushes/Merges ohne CI auch künftig nicht |
| F17 Doku-Drift | **bleibt, wird kleiner** (Phasen R0+R5) | TESTING.md/Kommentare beim Rückschnitt mit anpassen |

Netto: Von 17 Findings bleiben **zwei technische Arbeitspakete** (F7+F8 Migrations-Hygiene,
F15/F17 Doku) und zwei herabgestufte Produktentscheidungen (F6, F13). Alles andere ist durch
PR #238 erledigt oder durch den Reset gegenstandslos.

## 5. Phasenplan

Jede Phase ist ein eigener PR mit vollständiger CI. Reihenfolge ist verbindlich, weil R1 die
Testbasis liefert, auf der R2 aufsetzt.

### R0 — Entscheidung fixieren und Konzept Rev. 5 (Docs, Größe S) — ✅ erledigt 2026-07-21 ([PR #255](https://github.com/blorbeer-cmd/LAN_2026/pull/255))

- `docs/KONZEPT-USER-MANAGEMENT.md` als Rev. 5 neu fassen: eine Gruppe pro Instanz, Events als
  einzige Scoping-Dimension, Rollenmodell eingefroren, Nicht-Ziele ausdrücklich: Mehrgruppen,
  MFA/ASVS-L2-Vollkonformität (Anspruch auf „L1 + sinnvolle L2-Härtungen“ zurücksetzen —
  angemessen für ~15 Freunde im LAN).
- `docs/plans/user-management-status.md` als historisch markieren und auf diesen Plan verweisen.
- Alt-PR [#177](https://github.com/blorbeer-cmd/LAN_2026/pull/177) wurde als obsolet geschlossen;
  [#179](https://github.com/blorbeer-cmd/LAN_2026/pull/179) blieb nach Prüfung als separater,
  ungemergter Changelog-PR offen und ist kein Bestandteil von R0.
- **Kein** Codeänderungsanteil.

### R1 — PR #238 mergen (Größe S, nur Merge + Changelog) — ✅ erledigt 2026-07-20 ([PR #238](https://github.com/blorbeer-cmd/LAN_2026/pull/238))

- Squash-Merge als [`601d43e`](https://github.com/blorbeer-cmd/LAN_2026/commit/601d43ee18b0b102c22e2ccbf47f089a7de14aad);
  Changelog-Eintrag liegt in diesem PR bei.
- #238 ist unabhängig delta-reviewt (`DELTA APPROVED`, CI grün) und behebt die realen
  Ein-Gruppen-Regressionen (F3/F4) sowie die Event-Scope-Härtung, die auch im Ein-Gruppen-Modell
  gebraucht wird (Events bleiben!).
- Ohne R1 müsste R2 dieselben Kiosk-/Vote-/Arrivals-Fixes selbst erfinden. Mit R1 ist die
  Zustell-Testmatrix die Absicherung für den Rückschnitt.
- Changelog-Einträge gemäß `docs/changelog/AGENTS.md` nachziehen (zahlt auf F15 ein).

### R2 — Mehrgruppen-Oberfläche entfernen (Größe M) — ✅ erledigt 2026-07-21 ([PR #258](https://github.com/blorbeer-cmd/LAN_2026/pull/258))

Server:

- `config.multiGroupsEnabled` und `MULTI_GROUPS_ENABLED` entfernen (`server/src/config.ts:67`).
- In `server/src/routes/groups.ts` entfernen: `POST /` (Gruppe anlegen), `GET/POST
  /invites/:code(/accept)`, `POST /:groupId/leave`, Archivieren/Hard-Delete. Erhalten bleiben:
  `GET /` (liefert genau die Startgruppe), `GET /:groupId`, Kiosk-Tokens, Tracking-Consent,
  Mitglieder, Rollenverwaltung, Audit, Test-User.
- `server/src/routes/index.ts:86` und `groupAuthorization.ts`: `x-group-id` weiter akzeptieren,
  aber jede Anfrage auf `DEFAULT_GROUP_ID` auflösen; fremde IDs antworten wie bisher 404. Kein
  API-Bruch für Bestandsclients.
- `server/src/groups.ts`: Einladungs-/Beitritts-/Archivierungslogik entfernen, Membership-Pflege
  für Rollen und Deaktivierung behalten.

Frontend:

- `public/js/groupContext.js` (417 Zeilen): Umschalter, „Gruppe anlegen“, Einladungslink,
  „verlassen/archivieren“ entfernen. Übrig bleibt höchstens die Kontextanzeige „Gruppenraum /
  Eventname“ (die bleibt wichtig, weil Events bleiben).
- `public/js/api.js`: `x-group-id` nicht mehr senden.

Tests:

- Tests der entfernten Endpunkte entfernen. Die Zwei-Gruppen-Regressionstests aus #238
  (`api.groupArrivalsFoodOrders.required.test.ts`, Teile von `realtime.delivery.required.test.ts`)
  erzeugen Gruppen über `POST /api/groups` und verlieren damit ihre Grundlage: die
  Zwei-Gruppen-Fälle werden entfernt, die **Event-Scope-Fälle bleiben vollständig** (Teilnehmer/
  Admin/Owner/Nichtteilnehmer, Kiosk-Allowlist, Widerruf am offenen Socket, Arcade-Event-Scopes,
  Legacy-Direct-Push). Das ist die bleibende Sicherheits-Testmatrix des Ein-Gruppen-Modells.
- `TESTING.md` und `OPERATIONS.md` (Flag-Verweise `OPERATIONS.md:91,108`) anpassen.

### R3 — Innenleben vereinfachen, nur wo es Wartung spart (Größe S–M, optional) — ✅ erledigt 2026-07-21 ([PR #260](https://github.com/blorbeer-cmd/LAN_2026/pull/260))

Bewusst zurückhaltend — kein Purismus-Refactoring:

- `requireMultiGroups`-Helfer und toten Einladungscode entfernen.
- Kommentare/Namen, die „mehrere Gruppen“ versprechen, auf den Ist-Zustand korrigieren (F17).
- **Nicht** anfassen: Resolver-Signaturen (`resolveGroupEventScope(groupId, …)` etc.),
  Zustellregeln, `group_id`-Spalten, Rollenprüfungen. Eine funktionierende, getestete Signatur mit
  konstantem Argument ist billiger als jede Umbau-Regression.

### R4 — Migrations-Hygiene (Größe S, gruppenunabhängig; F7+F8) — ✅ erledigt 2026-07-21 ([PR #257](https://github.com/blorbeer-cmd/LAN_2026/pull/257))

- Migrationen vor Ausführung nach `version` sortieren statt Registrierungsreihenfolge
  (`db.ts:663 ff.`; v44 ist derzeit vor v41–43 registriert).
- `ALTER TABLE play_sessions ADD COLUMN allocation_weight` (`db.ts` v44) mit
  Spalten-Existenzprüfung absichern; `createPushMuteTable()`/Kiosk-Tabellen in den
  Migrationszähler überführen oder als dokumentierte idempotente Ausnahme kennzeichnen.
- Tests: frische DB, Upgrade von Bestands-Fixture, wiederholter Start.

### R5 — Doku- und Changelog-Nachpflege (Größe S; F15/F17) — ✅ erledigt 2026-07-21 ([PR #261](https://github.com/blorbeer-cmd/LAN_2026/pull/261))

- Changelog-Lücken ab PR #214 nachtragen (`docs/changelog/AGENTS.md`-Regeln).
- `TESTING.md`-Migrationsbehauptung an R4 angleichen; veraltete Mehrgruppen-Kommentare final raus.

## 6. Reihenfolge, Aufwand, Abbruchsicherheit

```
R0 (Docs) ──┐
            ├──> R1 (#238 mergen) ──> R2 (Rückschnitt) ──> R3 (optional) ──> R5
R4 (Migrations-Hygiene) ── unabhängig, jederzeit ─────────────────────────────┘
```

- Grobschätzung: R0=S, R1=S, R2=M (größter Brocken, aber überwiegend Löschung), R3=S–M, R4=S,
  R5=S. Insgesamt ein Bruchteil der neun geplanten Fix-Phasen, weil Löschen billiger ist als
  Härten.
- Nach **jeder** Phase ist die App vollständig funktionsfähig und auslieferbar; es gibt keinen
  Zwischenzustand mit halber Isolation, weil nie eine zweite Gruppe existiert.
- Vor R2: Backup der produktiven `lan.db` (Standard-Betriebsregel, keine Migration nötig).

## 7. Leitplanken

1. Keine destruktive Schemamigration im Reset; `groups`/`group_memberships`/`group_id` bleiben.
2. Startgruppen-Seeding in `db.ts` bleibt unangetastet (Neuinstallationen brauchen es).
3. Agent-API und Kiosk-Token-Verträge bleiben unverändert.
4. Tests werden nur zusammen mit der API entfernt, die sie prüfen — Event-Scope-Tests bleiben
   vollständig (Richtlinie §4: keine Tests löschen, um grün zu werden; hier entfällt der
   Prüfgegenstand selbst).
5. Ein PR pro Phase, vollständige CI, Review vor Merge, keine Direkt-Pushes (F16).

## 8. Ausdrücklich verworfen

- **Harter Schema-Rückbau** (Spalten/Tabellen entfernen): neues XL-Risiko ohne Nutzerwert.
  Frühestens neu bewerten, wenn das Schema aus anderem Grund angefasst wird.
- **Kompletter Neuanfang der App**: Auth-Fundament, Events, Kiosk, Arcade, Tracking und die
  #238-Zustellmatrix sind wertvoll und funktionieren; weggeworfen würde vor allem Getestetes.
- **Multi-Gruppen „später doch noch“ hinter dem Flag schlummern lassen**: halb entfernte Features
  sind die teuerste Variante — tote Pfade, die weiter mitgetestet und mitgedacht werden müssen.

## 9. Getroffene Entscheidungen (Nutzer, 2026-07-20)

1. **Rollen bleiben:** Owner/Admin/Member der Startgruppe bleiben unverändert das
   Instanz-Rechtemodell. Kein Rückbau auf `is_admin`.
2. **F6 (Event-Selbstbeitritt) wird Backlog-UX-Feature:** „Event-Einladung annehmen/ablehnen“
   wird später als kleines Feature umgesetzt; im Reset keine Änderung, keine Sicherheitspriorität.
3. **`groupContext.js` wird reduziert, nicht entfernt:** Umschalter, Anlegen, Einladungslink,
   Verlassen/Archivieren entfallen in R2; die Kontextanzeige „Gruppenraum vs. Eventname“ bleibt.
