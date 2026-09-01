# PR #529: Retire nine fragile Challenge Rush challenges and push preview phases from the server

- Datum des Merges: 2026-09-01
- Branch: `claude/arcade-games-evaluation-s4ctmx`
- Merge-Commit: [`d326a4b`](https://github.com/blorbeer-cmd/LAN_2026/commit/d326a4b1dc519901545f845fc309426f0b14767b)
- Pull Request: [#529](https://github.com/blorbeer-cmd/LAN_2026/pull/529)

## Changelog

- Challenge Rush verliert neun Challenges (40 → 31). Ausgewählt wurde nach technischen Mustern,
  nicht nach Geschmack: `aim-trainer` und `whack-a-mole` hielten Deadlines pro Spieler über ein
  Polling-Intervall mit eigenem Pause-Einfrieren, `traffic-light` einen eigenen Server-Timer,
  `memory-sequence` die Reveal-Länge doppelt auf Client und Server, `memory-pairs` den
  aufwendigsten Client-Zustand des Arcade-Bereichs, `n-back` und `seen-before` Zustand über Trials
  hinweg bei nur 900 ms Eingabefenster auf Stufe 5. Inhaltlich degeneriert waren
  `sequence-transform` (erzeugte immer nur `×2+1`, die Schwierigkeit blieb wirkungslos) und
  `clock-angle` (halbe Grad wie 52,5° unter Zeitdruck).
- Damit entfallen `processTimedStepTimeouts`, der Green-Light-Timer, `seenBeforeSelection`, der
  Memory-Pairs-Reveal-Pfad sowie die zugehörigen Renderer, Interaktionen und CSS-Regeln.
- Die Merkphase der verbleibenden Preview-Challenges wechselt jetzt servergetrieben nach `input`.
  Vorher hing der Übergang allein daran, dass der Client das Ende seines eigenen Countdowns
  bemerkt und den Trial neu anfordert; Browser drosseln oder suspendieren Timer in
  Hintergrund-Tabs, weshalb ein währenddessen gesperrtes Handy bis zum Ablauf der
  Challenge-Deadline auf dem Merk-Bildschirm hängen blieb. Der Server armiert einen Preview-Timer
  pro Spieler, friert ihn bei Pause ein und taut ihn aus der bereits eingefrorenen Trial-Laufzeit
  wieder auf, analog zur bestehenden Challenge-Deadline. Die träge Umschaltung in `publicTrial`
  bleibt als Rückfallebene.
- Feuert dieser Timer minimal vor der Phasengrenze, prüft der Callback den maßgeblichen
  öffentlichen Trial-Zustand und armiert die Restzeit neu, statt eine zweite Preview zu senden und
  den servergetriebenen Übergang zu verlieren. Der Fall stammt aus dem Cross-Review durch `codex`.
- Der Client synchronisiert bei `visibilitychange` aus der Server-Restzeit neu und wiederholt seine
  Trial-Anfrage im Preview-Zweig, bis sie beantwortet ist — analog zur bereits selbstheilenden
  Timeout-Schleife des Eingabe-Zweigs.
- Das Socket-Timing-Profil erhält `previewMs`, damit der servergetriebene Wechsel innerhalb der
  verkürzten Testrunden überhaupt stattfinden kann. In Produktion und im Browserprofil gilt
  weiterhin die generierte Länge.
- Neue Tests decken den servergetriebenen Preview-Push ohne Client-Anfrage, das Halten des
  Wechsels über eine Pause hinweg und die Timer-Hygiene ab (ein beendetes Match armiert keinen
  Preview-Timer mehr). Zählwerte in bestehenden Tests werden aus `CHALLENGES` abgeleitet statt hart
  kodiert.
- Nicht Teil dieses PRs: Der Bot spielt weiterhin keine Trial-Challenges, sein Pool schrumpft von
  zehn auf sechs Single-Payload-Challenges, und die Challenge-Auswahl umgeht diesen Schutz
  unverändert — ein Solo-Match gegen die KI mit gewählter Trial-Challenge lässt den Bot garantiert
  0 Punkte holen.
