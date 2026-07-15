# PR #167: Add Scribble gallery voting

- Datum des Merges: 2026-07-13
- Branch: `codex/fix-scribble-watch-rerender`
- Merge-Commit: [`7b3832a`](https://github.com/blorbeer-cmd/Respawn/commit/7b3832ace7b76807e9b832137a157af24d9003f4)
- Pull Request: [#167](https://github.com/blorbeer-cmd/Respawn/pull/167)

## Changelog

- Nach jeder Scribble-Runde werden die gespeicherten Zeichnungen in einer Galerie gezeigt.
- Spieler und Zuschauer können Reaktionen vergeben und einen Favoriten wählen.
- Die Galerie löst sich bei vollständiger Abstimmung oder nach 30 Sekunden auf.
- Zuschauer können über eine Spieleridentität abstimmen, ohne Spielantworten zu sehen.
- Vorzeitiges Auflösen berücksichtigt auch das Verlassen und Trennen von Zuschauern.
- Galerie- und Realtime-Integrationstests ergänzt.
