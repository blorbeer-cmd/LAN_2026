# Branch: `codex/reset-plan-r3`

## Themenstrang

Reset-Plan Phase R3 (`docs/plans/reset-single-group.md` Abschnitt 5): veraltete Kommentare, die
zusätzliche Produktionsgruppen oder künftiges Cross-Group-Sharing suggerierten, auf das
Ein-Gruppen-Modell präzisiert. Die weiterhin bestehenden `group_id`-, Foreign-Key-, Token- und
Resolver-Grenzen sind nun ausdrücklich als beibehaltene Schema- und Autorisierungsmechanismen
beschrieben.

`requireMultiGroups` war bereits mit R2 vollständig entfernt. `server/src/invites.ts` enthält nur
aktive Konto-Einladungslogik (`register`/`claim`/`reset`) und blieb deshalb ebenso unangetastet wie
Resolver-Signaturen, Zustellregeln, Rollenprüfungen, Schema und Migrationen. Der R3-Diff besteht
ausschließlich aus Kommentaren und ändert weder API noch Verhalten.

R4-Migrationshygiene bleibt ein unabhängiger Themenstrang.

## Pull Requests

- [PR #260](https://github.com/blorbeer-cmd/LAN_2026/pull/260) (Draft, offen): R3 — Innenleben
  dokumentarisch auf das Ein-Gruppen-Modell ausrichten.
