# PR #255: R0: rewrite user-management concept as Rev. 5 single-group model

- Datum des Merges: 2026-07-21
- Branch: `claude/konzept-rev5-single-group-k78eou`
- Merge-Commit: [`4d52d50`](https://github.com/blorbeer-cmd/LAN_2026/commit/4d52d5065ed3b32dc6653a21f900a29d913af947)
- Pull Request: [#255](https://github.com/blorbeer-cmd/LAN_2026/pull/255)

## Changelog

- `docs/KONZEPT-USER-MANAGEMENT.md` vollständig als Rev. 5 (Ein-Gruppen-Modell) neu gefasst: eine
  Instanz bedient genau eine Freundesgruppe (Startgruppe bleibt intern im Schema bestehen, ist
  aber kein Bedienkonzept mehr), Events bleiben die einzige Scoping-Dimension, Rollenmodell
  `owner`/`admin`/`member` als eingefroren beschrieben, Nicht-Ziele um Mehrgruppenbetrieb, volle
  ASVS-L2-Konformität und MFA als Merge-Voraussetzung ergänzt.
- `docs/plans/user-management-status.md` als historisch markiert (Hinweisblock, Verweis auf
  `docs/plans/reset-single-group.md`); Originalinhalt unverändert erhalten.
- Reset-Plan Phase R0 (`docs/plans/reset-single-group.md` Abschnitt 5) abgeschlossen; R2–R5
  folgen als eigene PRs.
- Review-Fund vor Merge behoben: nicht existierende Helfernamen `requireGroupOwner`/
  `requireEventAccess` durch die real existierenden `requireGroupRole('owner')` und
  `resolveGroupResource`/`resolveEvent` + `requireGroupRole('admin')` ersetzt; unbelegte Zahl
  "rund 30 Routen-Dateien" durch eine belegte Schätzung ersetzt.
