# Branch: `claude/reset-phase-r2-multigroup-removal-u8s7j6`

## Themenstrang

Reset-Plan Phase R2 (`docs/plans/reset-single-group.md` Abschnitt 5): Mehrgruppen-Oberfläche und
-API ersatzlos entfernt, nachdem R0 (Konzept Rev. 5, PR #255) und R1 (#238 gemergt) die Grundlage
gelegt haben.

Server: `config.multiGroupsEnabled`/`MULTI_GROUPS_ENABLED` entfernt; `routes/groups.ts` auf die
retained Endpunkte reduziert (`GET /`, `GET /:groupId`, Kiosk-Tokens, Tracking-Consent,
Mitgliederliste, Rollenverwaltung, Audit, Test-User) — Gruppe anlegen, Einladungen,
Beitritt/Austritt und Archivieren entfernt; `groups.ts` um die zugehörige Logik verkleinert.
Mitglieder können aus der Startgruppe generell nicht mehr entfernt werden (zuvor nur während des
Rollouts gesperrt) — Konto-Deaktivierung ist der vorgesehene, reversible Weg. Frontend:
`groupContext.js` auf die Kontextanzeige plus Mitglieder-/Rollen-/Audit-/Test-User-Verwaltung
reduziert (Umschalter, Anlegen, Einladungslink, Verlassen/Archivieren entfernt); `api.js` sendet
`x-group-id` nicht mehr. `routes/index.ts`/`groupAuthorization.ts` brauchten keine Code-Änderung:
die bestehende Auflösung akzeptiert den Header bereits, verlangt aktive Mitgliedschaft und
antwortet auf jede nicht existierende oder nicht zugängliche Gruppen-ID unverändert mit 404 — ohne
Mehrgruppen-API bleibt damit faktisch nur die Startgruppe erreichbar.

Tests: `api.groups.required.test.ts` auf den Claim-Ownership-Test reduziert;
`api.groupArrivalsFoodOrders.required.test.ts` entfernt (ihr gesamter Prüfgegenstand war
Cross-Tenant-Isolation über eine zweite, per API erzeugte Gruppe). Die sieben vorbestehenden
Zwei-Gruppen-Suiten (`api.groupAuthorization`, `api.groupVotesDrafts`,
`api.groupOrganisationCommunication`, `api.groupCompetition`, `api.groupSeatingPings`,
`api.groupArcadeData`, `api.groupCatalogPresence`, `api.groupChecklist`, je
`.required.test.ts`) auf ein Ein-Gruppen-Modell umgeschrieben: Rollenprüfungen, Audit-Trennung,
Foreign-Key-Constraints und — wo die Domäne event-gebundene Daten hält — Isolation zwischen zwei
nacheinander getrackten Events derselben Gruppe bleiben vollständig erhalten; nur das Erzeugen einer
zweiten Gruppe über die entfernte API entfällt. `realtime.delivery.required.test.ts` blieb
unverändert (legt seine Testgruppen direkt per SQL an, nicht über die API, und bleibt damit eine
gültige Regression für den weiterhin bestehenden `groups`-Mechanismus). Die E2E-Suiten
(`phase5eIsolation.e2e.test.ts`, `authGate.e2e.test.ts`) wurden entsprechend angepasst; die Browser-
Testfälle der entfernten Anlegen-/Einladungs-Oberfläche wurden ersetzt bzw. entfernt.

Dokumentation: `TESTING.md`, `OPERATIONS.md` und `README.md` von `MULTI_GROUPS_ENABLED`-Verweisen
bereinigt und auf das Ein-Gruppen-Modell umgestellt.

Leitplanken eingehalten: keine destruktive Schemamigration (`groups`/`group_memberships`/`group_id`
bleiben bestehen), Startgruppen-Seeding in `db.ts` unangetastet, Resolver-Signaturen und
Rollenprüfungen unverändert, Rollen owner/admin/member unverändert.

**Vor dem Deploy dieser Änderung wird ein Backup der produktiven `lan.db` empfohlen** (Standard-
Betriebsregel; keine Migration nötig, rein vorsorglich).

## Pull Requests

- [PR #258](https://github.com/blorbeer-cmd/LAN_2026/pull/258) (Draft, offen): R2 — Mehrgruppen-
  Oberfläche entfernen.
