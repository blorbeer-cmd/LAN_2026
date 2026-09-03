# PR #535: Order review results by publication, tie the review lock to its timeout

- Datum des Merges: 2026-09-02
- Branch: `claude/session-f1se9g`
- Merge-Commit: [`f445962`](https://github.com/blorbeer-cmd/LAN_2026/commit/f445962a8cf59fb577ea39ac4574bfebf79b7b7e)
- Pull Request: [#535](https://github.com/blorbeer-cmd/LAN_2026/pull/535)

## Changelog

- Behebt die beiden Findings des Claude-Cross-Reviews zu
  [#534](pr-534-automate-codex-self-review-pipeline.md). Sie wurden für den Head `1ff1e3db`
  gemeldet, der Pull Request wurde vor der Behebung gemergt; die Folgearbeit begann deshalb auf
  einem neuen Branch von `origin/main`.
- `latestReviewResult` und `latestReviewResultFromAny` wählen das neueste Ergebnis nach
  Veröffentlichungszeitpunkt statt nach Array-Position. `fetchSnapshot` übergibt seit #534 eine aus
  Kommentaren und nativen Reviews zusammengesetzte Liste, deren Reihenfolge die zweier getrennt
  abgerufener Listen ist. Ein hinten angehängtes natives Review verdrängte damit jeden
  Marker-Kommentar, auch einen neueren, der es ablöst — ein veraltetes `pass` konnte so das
  Merge-Gate für einen Head öffnen, dessen letztes Ergebnis `changes-required` lautete.
- Beide Helfer teilen sich dafür `newestReviewResult`, das nach demselben Muster wie
  `previousReviewedHead` sortiert und die Listenposition nur noch als Tiebreak für Ergebnisse ohne
  Zeitstempel verwendet. `parseReviewResults` übernimmt für native Reviews `submittedAt`, weil diese
  kein `createdAt` tragen und sonst älter wirkten als jeder Kommentar.
- Die Lock-Staleness des Codex-Self-Reviews leitet sich aus `reviewTimeoutMinutes` ab statt aus
  einer hart verdrahteten 45-Minuten-Konstante. Ein erhöhter Timeout ließ eine zweite Invocation ein
  noch laufendes Review für tot erklären und ein Duplikat auf demselben Head starten.
  `reviewTimeoutMs` versorgt jetzt Lock und Prozess-Timeout und fällt für einen Wert ohne positive
  Dauer auf den Standard zurück, damit der Lock kein `NaN` als „abgelaufen“ liest.
- Aus dem Codex-Cross-Review dieses Branches, als Regression des vorigen Punktes: Ein unter 45
  Minuten konfigurierter Timeout machte das Fenster kürzer als die frühere feste Stunde, obwohl es
  beim Sperren beginnt und der Timeout nur den Codex-Subprozess umfasst — die ungetimte Vorbereitung
  davor blieb ungedeckt. `refreshLock` stempelt die Sperre deshalb dort neu, wo der getimte
  Subprozess startet. Die Sperrdatei trägt zusätzlich ein Token, und `releaseLock` entfernt sie nur,
  solange sie dieses Token enthält; nach einer Übernahme löscht die erste Invocation damit nicht
  mehr die Sperre der zweiten.
- Vier Regressionstests, jeder gegen den Stand vor seinem Fix gegengeprüft: das chronologisch neuere
  Ergebnis gewinnt über Listengrenzen hinweg, der Lock hält 70 Minuten nach dem Start unter einem
  90-Minuten-Timeout, das Fenster startet am getimten Subprozess neu, und nur der Eigentümer gibt
  die Sperre frei. `node --test scripts/*.test.mjs` läuft mit 362/362.
- Offen geblieben: Die ungetimte Vorbereitungsphase des Self-Review-Launchers hat keine eigene
  Schranke und ist nur durch den Stempel beim Sperren abgedeckt;
  `scripts/agent-pipeline-codex-adapter.mjs` berechnet denselben Timeout weiterhin inline, war aber
  nicht Teil der Findings.
- Keine sichtbare UI/UX-Änderung.
