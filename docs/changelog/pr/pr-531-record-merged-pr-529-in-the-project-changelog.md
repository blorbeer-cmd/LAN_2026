# PR #531: Record merged PR #529 in the project changelog

- Datum des Merges: 2026-09-01
- Branch: `claude/arcade-games-evaluation-s4ctmx`
- Merge-Commit: [`31150a6`](https://github.com/blorbeer-cmd/LAN_2026/commit/31150a6096a8cbe4c164c828f7d2da868bf8eaa7)
- Pull Request: [#531](https://github.com/blorbeer-cmd/LAN_2026/pull/531)

## Changelog

- Reine Dokumentationsänderung: Der nach `main` gemergte PR
  [#529](pr-529-retire-nine-fragile-challenge-rush-challenges-and-push-preview-phases-from-the-server.md)
  wird in der Projekthistorie nachgeführt, damit PR-Datei, Branch-Datei und Übersicht wieder mit dem
  tatsächlichen Git-Stand übereinstimmen.
- Neue PR-Datei mit den echten Merge-Metadaten (Merge am 2026-09-01, Branch
  `claude/arcade-games-evaluation-s4ctmx`, Merge-Commit `d326a4b`). Die Zusammenfassung nennt die
  neun entfernten Challenges mit ihrem jeweiligen technischen Grund, den servergetriebenen Wechsel
  der Merkphase samt Neu-Armierung bei zu früh feuerndem Timer, die Client-Resynchronisierung bei
  `visibilitychange`, den Testschalter `previewMs` und den offen gebliebenen Bot-Pool-Bypass.
- Die Branch-Datei löst den Entwurfsvermerk durch den Merge-Eintrag ab und schließt den Branch mit
  dem Hinweis ab, dass Folgearbeit auf einem neuen Branch von `origin/main` beginnt.
- Die Chronologie in `docs/changelog/README.md` erhält die Zeile für #529 an oberster Stelle.
- Die beiden Zählwerte der Übersicht werden auf die tatsächliche Dateizahl korrigiert (230
  PR-Seiten, 191 Branch-Seiten). Die Branch-Zahl stand auf 188 und war unabhängig von diesem
  Eintrag bereits veraltet.
- Der Stand-Absatz benennt #353–#528 ausdrücklich als noch nicht erfassten Bereich, damit die
  Übersicht ihre Abdeckung nicht überzeichnet. Das Schließen dieser Lücke war bewusst nicht Teil
  des PRs.
- Der PR lief auf demselben Branch wie #529, entgegen der Regel, dass Folgearbeit nach einem Merge
  auf einem neuen Branch von `origin/main` beginnt.
