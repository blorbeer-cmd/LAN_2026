// Arcade help stays in the lazy Arcade subtree. Core loads this catalog only
// after an Arcade route is opened; importing it cannot start a lobby or match.
const s = (id, title, text, target = '') => ({ id, title, text, target });
const room = (title, rules) => ({
  title,
  examples: { default: {
    title: `${title} · Beispielpartie`,
    rows: title === 'Chimp Test'
      ? [{ title: 'Alex', detail: '8 Zahlen gemerkt · 1 Strike', badge: 'Versuch läuft' }]
      : [{ title: 'Alex und Sam', detail: `${title} · Gemeinsame Runde`, badge: 'Läuft' }, { title: 'Spielaktionen', detail: 'Pause · Ton · Vollbild' }],
    actions: ['Revanche'],
  } },
  chapters: [{ id: 'play', title: 'Steuerung und Ablauf', steps: [
    ...rules,
    s('pause', 'Pause und Vollbild', 'Die Spielaktionen steuern Pause, Ton und Vollbild. Escape verlässt das Vollbild; eine Pause beendet die Partie nicht.', '.arcade-game-header-actions'),
    s('connection', 'Nach einem Verbindungsabbruch', 'Kehre zur selben Partie zurück. Üblicherweise bleibt eine Minute zum Wiederverbinden; bei pausiertem Spiel ohne wartende Mitspieler sind es zehn Minuten.'),
    s('result', 'Ergebnis und Revanche', 'Nach dem Ende zeigt die Ergebniskarte den Ausgang. Revanche öffnet eine neue Lobby; die übrigen Personen müssen wieder beitreten und bereit sein.', '[data-rematch-request]'),
  ] }],
});

export const ARCADE_TOURS = {
  arcade: {
    title: 'Arcade',
    examples: { default: { title: 'Tetris · Lobby', rows: [{ title: 'Alex', detail: 'Host', badge: 'Bereit' }, { title: 'Sam', detail: 'Gast', badge: 'Noch nicht bereit' }], actions: ['Beitreten', 'Bereit', 'Starten'] } },
    chapters: [{ id: 'lobby', title: 'Lobby und Mitspielen', steps: [
      s('open', 'Lobby öffnen', 'Wähle ein Spiel und seinen Modus. Das erstellt zunächst eine Lobby; die Partie beginnt erst nach dem Start.', '#arcade-create-lobby'),
      s('join', 'Mitspielen', 'Beitreten belegt einen freien Platz. Bei Doppel wählst du dein Team. Eine eigene Lobby wird erst nach Bestätigung durch eine andere ersetzt.', '[data-join-lobby]'),
      s('ready', 'Bereit melden', 'Gäste melden ihre Bereitschaft. Der Host startet, sobald Teilnehmerzahl und Bereitschaft passen; ein gesperrter Start nennt die fehlende Voraussetzung.', '[data-ready]'),
      s('watch', 'Weiterspielen oder zuschauen', 'Eine laufende eigene Partie bietet Weiterspielen. Zuschauen öffnet eine lesende Ansicht; verborgene Spielinformationen bleiben auch dort verborgen.', '[data-watch-match]'),
      s('statistics', 'Arcade-Statistik', 'Die Statistik wertet Browserpartien aus. Chimp Test besitzt eine eigene Bestwert-Rangliste und zählt keine normalen Siege oder Niederlagen.', '.collapsible-section'),
    ] }],
  },
  quizRoom: room('Quiz', [
    s('question', 'Frage und Zeit', 'Lies Frage und Kategorie und wähle deine Antwort innerhalb des Zeitlimits. Die Auflösung erscheint nach der Antwortphase.', '.quiz-question'),
    s('answer', 'Auflösung ansehen', 'Die nächste Phase zeigt die richtige Antwort. Der Punktestand entwickelt sich über die Fragen der gemeinsamen Runde.', '.quiz-question'),
  ]),
  tetris: room('Tetris', [
    s('move', 'Steine steuern', 'Bewege und drehe den fallenden Stein mit den angezeigten Tasten oder Touch-Steuerungen. Vollständige Reihen verschwinden und bringen Punkte.', 'canvas'),
    s('modes', 'Duell oder Arena', 'Im Duell spielen zwei Personen, in der Arena drei bis acht. Dein Spielfeld bleibt groß; die anderen Felder zeigen den gemeinsamen Spielstand.', 'canvas'),
  ]),
  pong: room('Pong', [
    s('controls', 'Deinen Schläger bewegen', 'Steuere den Schläger über die angezeigten Tasten oder Touch-Flächen. Halte den Ball im Spiel und achte auf deine Seite.', 'canvas'),
    s('teams', 'Duell und Doppel', 'Im Duell trittst du allein an, im Doppel mit einem Mitspieler. Die Lobby legt Teams und Zielpunktzahl vor dem Start fest.', 'canvas'),
  ]),
  blobby: room('Blobby Volley', [
    s('controls', 'Bewegen und springen', 'Nutze die angezeigte Steuerung, um dich zu bewegen und den Ball über das Netz zu spielen. Auf dem Handy stehen Touch-Flächen bereit.', 'canvas'),
    s('mode', 'Gemeinsam oder allein', 'Duell spielt eins gegen eins, Doppel zwei gegen zwei. Die Teams und die Siegpunktzahl werden vor dem Start in der Lobby festgelegt.', 'canvas'),
  ]),
  snake: room('Snake', [
    s('move', 'Deine Richtung steuern', 'Lenke deine Schlange mit den angezeigten Tasten oder Touch-Steuerungen. Vermeide Kollisionen und behalte deine Farbe im Blick.', 'canvas'),
    s('arena', 'Classic und Arena', 'Classic ist ein Duell. In der Arena spielen drei bis acht Personen und die sichere Zone schrumpft; ausgeschiedene Personen bleiben gekennzeichnet.', 'canvas'),
  ]),
  battleship: room('Schiffe versenken', [
    s('fleet', 'Flotte platzieren', 'Wähle ein Schiff und seine Ausrichtung und setze es ins Feld. Zufällig verteilt die Flotte; Zurücksetzen beginnt die Platzierung neu.', '[data-select-ship]'),
    s('ready', 'Flotte bereit melden', 'Prüfe deine Schiffe und bestätige Flotte bereit. Die Schussphase beginnt erst, wenn beide Flotten fertig sind.', '#battleship-submit-setup'),
    s('shoot', 'Schüsse setzen', 'Wähle im gegnerischen Feld ein Ziel, sobald du am Zug bist. Treffer und versenkte Schiffe werden im Spielfeld markiert.', 'canvas'),
  ]),
  chimp: room('Chimp Test', [
    s('remember', 'Zahlen merken', 'Merke dir die Positionen. Mit dem Antippen der 1 verschwinden die übrigen Zahlen; tippe sie anschließend in aufsteigender Reihenfolge an.', '[data-chimp-cell]'),
    s('strikes', 'Drei Fehler beenden den Versuch', 'Ein Fehler zählt als Strike und zeigt dir kurz die Lösung. Nach drei Strikes endet dein persönlicher Versuch.', '[data-chimp-cell]'),
    s('best', 'Dein Bestwert zählt', 'Gespeichert wird dein Soloergebnis, ohne Siege oder Niederlagen. Die gemeinsame Rundenrangliste ist eine zusätzliche Anzeige; Neuladen startet keinen neuen Versuch.'),
  ]),
  scribbleRoom: room('Scribble', [
    s('draw', 'Zeichnen oder raten', 'Die zeichnende Person nutzt die Werkzeuge; die übrigen geben ihre Vermutungen im Ratefeld ein. Zuschauer erhalten keine geheimen Wörter oder Tipps.', 'canvas'),
  ]),
  challengeRush: room('Challenge Rush', [
    s('challenge', 'Aufgabe zuerst lesen', 'Jede Challenge hat eine eigene Aufgabe und Zeitgrenze. Merken, Warten und Eingeben sind unterschiedliche Phasen; die Anzeige führt dich durch den Wechsel.', '.challenge-rush-stage'),
  ]),
  arcadeWatch: {
    title: 'Arcade-Zuschauen',
    examples: { default: { title: 'Zuschauen · Beispielpartie', rows: [{ title: 'Alex gegen Sam', detail: 'Gemeinsamer Spielstand', badge: 'Läuft' }, { title: 'Deine Rolle', detail: 'Zuschauer · Keine Spielaktionen' }], actions: ['Zuschauen beenden'] } },
    chapters: [{ id: 'watch', title: 'Zuschauen', steps: [
      s('read', 'Gemeinsam verfolgen', 'Du siehst den Spielstand, kannst aber nicht mitspielen oder das Ergebnis ändern. Die Ansicht verwendet dieselbe Spielfelddarstellung wie die Partie.', 'canvas'),
      s('hidden', 'Geheime Informationen bleiben verborgen', 'Scribble zeigt Zuschauern keine Wörter, Tipps oder Vermutungen. Chimp Test zeigt nur den Fortschritt, keine Zahlenpositionen.', 'canvas'),
      s('leave', 'Ansicht verlassen', 'Beenden verlässt nur deine Zuschaueransicht. Die laufende Partie der Spieler wird dadurch nicht beendet.'),
    ] }],
  },
};
