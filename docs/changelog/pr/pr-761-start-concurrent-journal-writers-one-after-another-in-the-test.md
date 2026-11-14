# PR #761: Start concurrent journal writers one after another in the test

- Datum des Merges: 2026-11-13
- Branch: `claude/a7-stable-concurrent-writers`
- Merge-Commit: [`329d65c`](https://github.com/blorbeer-cmd/LAN_2026/commit/329d65c)
- Pull Request: [#761](https://github.com/blorbeer-cmd/LAN_2026/pull/761)

## Changelog

- Der Test „independent concurrent writers …“ in `pointsJournal.test.ts` startet die beiden Schreibprozesse nacheinander: Beim Laden von `db.js` schreibt `seedCatalogGames` in einer deferred Transaktion und konnte bei gleichzeitigem Start an `SQLITE_BUSY` scheitern. Nur die Journal-Schreibzugriffe laufen weiter parallel.
- Ein Kindprozess, der ohne Antwort endet, lässt den Test sofort mit Exit-Code und stderr scheitern statt in den 20-s-Timeout zu laufen.

## Historischer Kontext

Behebt A7 aus Issue #755. Reproduziert mit eng synchronisiertem Start (2 von 120 Starts mit `SQLITE_BUSY` in `seedCatalogGames`); Stresslauf mit je 200 Ausführungen: paralleler Start 4 Fehlschläge, gestaffelter Start 0. Ohne Review gemergt; die Zusammenfassung stammt aus PR-Beschreibung und Diff.
