# PR #758: Close re-rolled draw markets and bundle betting notices

- Datum des Merges: 2026-11-13
- Branch: `ccr-ce451f03-d7nhep`
- Merge-Commit: [`5224725`](https://github.com/blorbeer-cmd/LAN_2026/commit/5224725)
- Pull Request: [#758](https://github.com/blorbeer-cmd/LAN_2026/pull/758)

## Changelog

- Wird für dasselbe Spiel und dieselben Spieler erneut „Teams auslosen“ gewählt, sendet der Client die zuvor angezeigte, unbespielte Auslosung als `replacesDrawId` mit. Bei gleichem Spiel, gleicher Besetzung, ohne Ergebnis und ohne Turnier setzt der Server an der verworfenen Auslosung `betting_allowed = 0` und erstattet einen offenen Markt im selben Schritt („Neu ausgelost“). Das gilt auch, wenn bei ausgeblendeten LAN-Punkten noch kein Markt existiert. Eine ungültige `replacesDrawId` ergibt 400, eine nicht passende wird ignoriert.
- „Neue Wettmöglichkeit“ für Auslosungen geht erst 30 s nach dem Auslosen hinaus (`DRAW_NOTICE_DELAY_MS`, im Browser-Schnellprofil 1 s). Schnelles Neu-Auslosen kündigt so nur die behaltene Aufstellung an.
- Gemeinsam öffnende Turniermärkte teilen sich eine Mitteilung (`betting-open:tournament:<id>:<anker>`). Sie wird über `resolveBettingNotice` zurückgezogen, sobald keiner dieser Märkte mehr Tipps annimmt, auch nach dem Löschen des Turniers.
- Aus `notifyBettingRound` wird das gruppierende `notifyBettingRounds`; Echtzeit-Signale gehen nur einmal je Event raus.

## Historischer Kontext

Behebt Bug A2 aus dem Wett-Feedback in Issue #755. Zwei `pr-review`-Durchgänge verlangten, das Verwerfen auch ohne bereits angelegten Markt dauerhaft zu speichern und die gemeinsame Turniermitteilung nach einer Cascade-Löschung zurückzuziehen; beides wurde vor dem Merge ergänzt. Der dritte Durchgang auf `f934e63` blieb ohne Findings. Die Zusammenfassung stammt aus der PR-Beschreibung, den Reviews und den Commits.
