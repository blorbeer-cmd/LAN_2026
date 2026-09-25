# Branch: `claude/gruppen-eventtyp`

## Themenstrang

Dieser Branch ist mit 1 PR in der GitHub-Historie vertreten.

| PR | Status | Titel |
|---:|---|---|
| [#645](https://github.com/blorbeer-cmd/LAN_2026/pull/645) | gemergt am 2026-09-17 | Gruppen als Eventtyp und Events-Bereich aus Orga herausgelöst |

## Inhalt

Neben LAN-Party und Allgemeinem Event gibt es die **Gruppe**: einen dauerhaften Kreis ohne
Zeitraum und ohne Kosten, für alles, was sich immer wieder trifft statt einmal stattzufinden. Sie
wird sofort veröffentlicht statt als Entwurf auf ein Datum zu warten, ihre Startausstattung sind
To-Do, Essen, Musik, Spielekatalog, Arcade und Umfragen, und der Server weist Zeitraum wie
Kostenfelder ausdrücklich ab, damit Zahlungserinnerungen und Bezahlt-Status für sie gar nicht erst
entstehen können. Beendet werden kann sie wie jeder andere Arbeitsbereich — der eine
Lebenszyklusschritt, den beide Arten teilen.

Die Packliste wurde dafür aus „Aufgaben & Mitbringen“ als eigener schaltbarer Bereich abgespalten,
mit getrennten Guards für `/api/checklist/items` und `/api/checklist/tasks`; das Lesen der
Packliste ist mitgeschützt, weil es den Grundstock anlegt.

Gleichzeitig verlässt **Events & Gruppen** die Orga-Tableiste: Orga organisiert Arbeit innerhalb
des gewählten Arbeitsbereichs, diese Ansicht wählt und erstellt die Arbeitsbereiche selbst. Sie
führt den „Mehr“-Hub an, steht auf dem Desktop neben Home und ist aus dem Umschalter direkt
erreichbar; Events und Gruppen stehen dort in zwei getrennten Listen. Wer einen Arbeitsbereich
anlegt, ist seither automatisch zugesagtes Mitglied.

Die bisherige „Gruppe“ — die interne Zugriffsgrenze — heißt in der Oberfläche jetzt **Community**,
damit das Wort „Gruppe“ eindeutig dem neuen Eventtyp gehört. Datenbank, Schnittstellen und
Modulnamen bleiben bei `group`.
