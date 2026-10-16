import { escapeHtml } from './format.js';

// Presentation data only. These scenes never import API clients or view actions.
const row = (title, detail, badge = '') => ({ title, detail, badge });
const field = (label, value, type = 'text') => ({ label, value, type });
const card = (title, rows, actions = [], note = '') => ({ title, rows, actions, note });
const form = (title, fields, actions, focus = '') => ({ title, fields, actions, focus, kind: 'dialog' });
const focused = (scene, focus) => ({ ...scene, focus });

const gameForm = form('Spiel vorschlagen', [
  field('Titel', 'Rocket League'), field('Plattform', 'Steam'), field('Plattform-Link', 'https://store.steampowered.com/'),
  field('YouTube-Gameplay-Link', 'https://www.youtube.com/'), field('Genre', 'Sport · Rennspiel'),
  field('Info', 'Controller empfohlen'), field('Sitznachbarn bei Auslosung', true, 'checkbox'),
], ['Vorschlagen']);
const gameRatings = card('Rocket League', [row('Dein Bock', '0  1  2  3  [4]  5', '4 von 5'), row('Dein Skill', '0  1  2  [3]  4  5', '3 von 5')]);
const voteForm = form('Abstimmung starten', [
  field('Titel', 'Samstagabend'), field('Beschreibung', 'Was spielen wir als Nächstes?'),
  field('Anonym abstimmen', false, 'checkbox'), field('Zwischenstand verbergen', true, 'checkbox'),
  field('Spiele auswählen', 'Rocket League · Counter-Strike 2 · Trackmania'),
], ['Abstimmung starten']);
const ballot = form('Samstagabend · Dein Stimmzettel', [
  field('Rocket League', '4 von 5'), field('Counter-Strike 2', '2 von 5'), field('Trackmania', '0 von 5'),
  field('Bock übernehmen', true, 'checkbox'),
], ['Speichern']);
const voteResult = card('Samstagabend · Ergebnis', [
  row('Rocket League', '12 Punkte · 3 Stimmen', 'Platz 1'), row('Counter-Strike 2', '8 Punkte · 3 Stimmen', 'Platz 2'),
  row('Trackmania', '2 Punkte · 3 Stimmen', 'Platz 3'),
], ['Match generieren'], 'Abgeschlossen · 3 Personen haben abgestimmt');
const pollForm = form('Umfrage starten', [
  field('Titel', 'Was essen wir am Samstag?'), field('Beschreibung', 'Bitte bis Freitag antworten'),
  field('Antwortart', 'Eine Auswahl'), field('Fällig bis', 'Freitag, 18:00'),
  field('Anonym abstimmen', false, 'checkbox'), field('Zwischenstand verbergen', true, 'checkbox'),
  field('Option 1', 'Pizza'), field('Option 2', 'Burger'),
], ['Umfrage starten']);
const pollAnswer = form('Was essen wir am Samstag?', [field('Deine Auswahl', 'Pizza')], ['Speichern']);
const travelForm = form('Meine An- & Abreise', [field('Ankunft', 'Freitag, 18:00'), field('Abreise', 'Sonntag, 16:00'), field('Notiz', 'Ich bringe einen Monitor mit')], ['Speichern']);
const carpoolForm = form('Fahrgemeinschaft anlegen', [field('Bezeichnung', 'Auto Alex'), field('Von wo', 'Hamburg'), field('Start', 'Freitag, 16:00'), field('Ankunft', 'Freitag, 18:00'), field('Freie Plätze (ohne dich)', '3')], ['Anlegen']);
const carpool = card('Auto Alex · Anreise', [row('Alex', 'Fahrer · Hamburg → LAN'), row('Sam', 'Mitfahrer · Ankunft 18:00'), row('Freie Plätze', '2 von 3 Plätzen verfügbar')], ['Eintragen']);
const todoForm = form('To-Do erstellen', [field('Art', 'Mitbring-Anfrage'), field('Titel', 'Mehrfachsteckdosen'), field('Beschreibung', 'Mindestens 6 Steckplätze'), field('Fällig bis', 'Freitag')], ['To-Do erstellen']);
const todo = card('Mehrfachsteckdosen', [row('Beschreibung', 'Mindestens 6 Steckplätze'), row('Alex', 'Ich bringe zwei mit', 'Übernommen'), row('Fällig bis', 'Freitag', 'Offen')], ['Übernehmen', 'Erledigt']);
const matchForm = form('Neue Auslosung', [field('Spiel auswählen', 'Rocket League'), field('Modus', 'Auslosen'), field('Spieler', 'Alex · Sam · Kim · Jo'), field('Teams', '2'), field('Sitznachbarn', true, 'checkbox')], ['Teams auslosen']);
const teams = card('Rocket League · Aufstellung', [row('Team 1', 'Alex (Skill 4) · Kim (Skill 2)', 'Skill 6'), row('Team 2', 'Sam (Skill 3) · Jo (Skill 3)', 'Skill 6')], ['Ergebnis', 'Turnier erstellen']);
const resultForm = form('Ergebnis', [field('Team 1', 'Alex · Kim'), field('Team 2', 'Sam · Jo'), field('Sieger', 'Team 1'), field('Punktestand', '3 : 1')], ['Speichern']);
const tournamentForm = form('Turnier erstellen', [field('Name', 'Rocket-League-Cup'), field('Format', 'Liga'), field('Teams', 'Team 1 · Team 2'), field('Hin- und Rückrunde', true, 'checkbox'), field('Mit Punktestand', true, 'checkbox'), field('Lobby-Basisname', 'LAN-Cup'), field('Passwort', 'Beispiel-Passwort')], ['Turnier erstellen']);
const foodForm = form('Neue Sammelbestellung', [field('Titel', 'Pizza bei Luigi'), field('Versand', 'Samstag, 19:00'), field('Info', 'Bitte rechtzeitig eintragen'), field('Speisekarte', 'https://example.org/speisekarte'), field('PayPal', 'https://paypal.me/beispiel'), field('Trinkgeld in %', '10')], ['Bestellung öffnen']);
const foodItem = form('Pizza bei Luigi · Position hinzufügen', [field('Gericht', 'Pizza Margherita'), field('Menge', '2'), field('Einzelpreis', '8,00 €')], ['Hinzufügen']);
const foodOrder = card('Pizza bei Luigi', [row('Alex · Pizza Margherita', '2 × 8,00 € + 10 % Trinkgeld', '17,60 €'), row('Sam · Pizza Funghi', '1 × 9,00 € + 10 % Trinkgeld', '9,90 €')], ['Bestellübersicht', 'Abschicken'], 'Offen · Versand Samstag, 19:00');
const payment = card('Pizza bei Luigi · Abgeschickt', [row('Alex', '17,60 €', 'Unbezahlt'), row('Sam', '9,90 €', 'Bezahlt')], ['PayPal', 'Bezahlt markieren'], 'Ein Zahlungsstatus gilt für alle Positionen einer Person.');

export const CORE_TOUR_EXAMPLES = {
  home: {
    default: card('Aktuell', [row('Samstagabend', 'Vote · 3 Spiele', 'Läuft'), row('Pizza bei Luigi', 'Essen · Versand 19:00', 'Offen')]),
    chapters: {
      context: card('Arbeitsbereich', [row('Sommer-LAN', 'Freitag bis Sonntag', 'Ausgewählt'), row('Spieleabend', 'Samstag', 'Anderes Event')]),
      notifications: card('Deine Mitteilungen', [row('Zahlung noch offen', 'Pizza bei Luigi · 17,60 €', 'Ungelesen'), row('Turnier bereit', 'Dein Team: Alex und Kim', 'Gelesen')], ['Öffnen', 'Aufräumen']),
    },
    steps: { 'overview/todos': card('Meine To-Dos', [row('Pizza bezahlen', 'Sommer-LAN · 17,60 €'), row('Mehrfachsteckdosen mitbringen', 'Spieleabend · Freitag')]) },
  },
  events: {
    default: card('Sommer-LAN', [row('Termin und Ort', 'Freitag bis Sonntag · Hamburg'), row('Deine Teilnahme', 'Noch nicht beantwortet', 'Eingeladen'), row('Beitrag', '25,00 € · Fällig bis Freitag')], ['Zusagen', 'Absagen']),
    chapters: { organise: form('Event anlegen', [field('Name', 'Sommer-LAN'), field('Zeitraum', 'Freitag bis Sonntag'), field('Ort', 'Hamburg'), field('Beitrag pro Person', '25,00 €'), field('Bereiche', 'Spiele · Vote · Orga')], ['Anlegen']) },
    steps: { 'participate/confirm': card('Kalender', [row('Sommer-LAN', 'Termin wurde in deinen Kalender übernommen'), row('Respawn-Bestätigung', 'Noch offen')], ['Eingetragen']) },
  },
  gameCatalog: {
    default: gameRatings, chapters: { catalog: gameForm },
    steps: {
      'ratings/bock': focused(gameRatings, 'Dein Bock'), 'ratings/skill': focused(gameRatings, 'Dein Skill'),
      'ratings/suggestion': card('Skill-Vorschlag', [row('Eigene Wertung', '3 von 5'), row('Vorschlag aus Ergebnissen', '4 von 5')], ['Vorschlag übernehmen']),
      'catalog/propose': focused(gameForm, 'Titel'), 'catalog/platform': focused(gameForm, 'Plattform-Link'),
      'catalog/genres': focused(gameForm, 'Genre'), 'catalog/notes': focused(gameForm, 'Info'),
      'catalog/neighbors': focused(gameForm, 'Sitznachbarn bei Auslosung'),
      'catalog/details': card('Rocket League · Details', [row('Plattform', 'Steam'), row('Genre', 'Sport · Rennspiel'), row('Info', 'Controller empfohlen')], ['Plattform öffnen', 'Gameplay ansehen']),
      'catalog/promote': card('Rocket League · Vorschlag', [row('Status', 'Bewertbar · noch nicht für neue Runden verfügbar')], ['In Katalog übernehmen']),
      'catalog/process': form('Spiel bearbeiten', [field('Spiel', 'Rocket League'), field('Prozessname', 'RocketLeague.exe')], ['Speichern']),
      'catalog/history': card('Rocket League · Historie', [row('Samstagabend', 'Abgeschlossener Vote · Platz 1'), row('Match', 'Alex und Kim gewinnen 3 : 1')]),
    },
  },
  votes: {
    default: ballot, chapters: { result: voteResult },
    steps: {
      'vote/start': focused(voteForm, 'Titel'), 'vote/setup-info': focused(voteForm, 'Beschreibung'),
      'vote/setup-privacy': focused(voteForm, 'Anonym abstimmen'), 'vote/setup-games': focused(voteForm, 'Spiele auswählen'),
      'vote/prefill': focused(ballot, 'Rocket League'), 'vote/zero': focused(ballot, 'Trackmania'),
      'vote/adopt': focused(ballot, 'Bock übernehmen'),
      'vote/submitted': card('Samstagabend · Stimme gespeichert', [row('Deine Teilnahme', 'Vollständiger Stimmzettel abgegeben', 'Gespeichert'), row('Katalog · Dein Bock', 'Rocket League 4 · Counter-Strike 2 2 · Trackmania 0')], ['Stimme ändern']),
      'vote/hidden': card('Samstagabend · Zwischenstand verborgen', [row('Dein Stimmzettel', 'Gespeichert'), row('Ergebnis', 'Nach Rundenende sichtbar')]),
      'result/runoff': form('Stichwahl', [field('Genau ein Spiel auswählen', 'Rocket League'), field('Weitere Option', 'Counter-Strike 2')], ['Speichern']),
      'result/match': matchForm, 'result/players': focused(matchForm, 'Spieler'),
      'result/history': card('Vote-Historie', [row('Samstagabend', 'Rocket League gewinnt · 3 abgegebene Stimmen', 'Gespeichert')], [], 'Eine beendete Runde ohne abgegebene Stimmen wird nicht aufbewahrt.'),
    },
  },
  eventPolls: {
    default: pollAnswer, chapters: { manage: pollForm },
    steps: {
      'answer/result': card('Was essen wir am Samstag? · Ergebnis', [row('Pizza', '3 Stimmen', 'Platz 1'), row('Burger', '1 Stimme')], [], 'Eventdaten bleiben unverändert.'),
      'answer/changed': form('Neue Option ergänzen', [field('Pizza', 'Ausgewählt'), field('Burger', 'Nicht ausgewählt'), field('Pasta', 'Neue Option · Antwort offen')], ['Speichern']),
      'manage/start': focused(pollForm, 'Titel'), 'manage/mode': focused(pollForm, 'Antwortart'),
      'manage/choices': focused(pollForm, 'Option 1'), 'manage/privacy': focused(pollForm, 'Zwischenstand verbergen'),
      'manage/deadline': focused(pollForm, 'Fällig bis'),
      'manage/manual': card('Was essen wir am Samstag?', [row('Alex', 'Geantwortet'), row('Sam', 'Antwort fehlt')], ['Ausstehende erinnern']),
      'manage/close': card('Was essen wir am Samstag? · Beendet', [row('Pizza', '3 Stimmen', 'Gewinner'), row('Burger', '1 Stimme')], ['Wieder öffnen', 'Neue Runde']),
    },
  },
  arrivals: {
    default: travelForm,
    steps: {
      'travel/purpose': card('Planung für die Orga', [row('Freitag, 18:00', 'Alex und Sam kommen mit einer Fahrgemeinschaft'), row('Sonntag, 16:00', 'Geplante Abreise')]),
      'travel/all': card('Alle Zeiten', [row('Alex', 'Freitag 18:00 → Sonntag 16:00', 'Fahrer'), row('Sam', 'Freitag 18:00 → Sonntag 16:00', 'Mit Alex')]),
      'travel/offer': carpoolForm, 'travel/join': carpool, 'travel/edit': focused(carpoolForm, 'Ankunft'),
      'travel/leave': card('Sam · Nach dem Austragen', [row('Fahrgemeinschaft', 'Keine'), row('Eigene Ankunft', 'Nicht eingetragen')]),
    },
  },
  checklist: {
    default: todo,
    steps: {
      'tasks/create': focused(todoForm, 'Art'), 'tasks/title': focused(todoForm, 'Titel'), 'tasks/deadline': focused(todoForm, 'Fällig bis'),
      'tasks/claim': form('To-Do übernehmen', [field('Aufgabe', 'Mehrfachsteckdosen'), field('Kommentar', 'Ich bringe zwei mit')], ['Übernehmen']),
      'tasks/release': card('Mehrfachsteckdosen', [row('Beteiligung', 'Keine Person mehr zugewiesen', 'Offen')], ['Übernehmen']),
      'tasks/done': card('Mehrfachsteckdosen', [row('Alex', 'Zwei Steckdosen mitgebracht', 'Erledigt')], ['Archivieren']),
    },
  },
  checklistPacking: { default: card('Meine Packliste', [row('Netzwerkkabel', 'Noch einpacken', 'Offen'), row('Headset', 'Schon eingepackt', 'Erledigt'), row('Controller', 'Eigener Eintrag', 'Offen')], ['Eintrag hinzufügen', 'Bearbeiten']) },
  matchmaking: {
    default: matchForm, chapters: { draft: card('Captain Draft · Sam ist dran', [row('Team Alex', 'Alex · Kim'), row('Team Sam', 'Sam'), row('Spielerpool', 'Jo')], ['Jo auswählen']), 'tournament-setup': tournamentForm },
    steps: { 'draw/teams': teams, 'draw/next': teams, 'draw/result': resultForm, 'draw/snapshot': teams, 'tournament-setup/format': focused(tournamentForm, 'Format'), 'tournament-setup/names': focused(tournamentForm, 'Mit Punktestand'), 'tournament-setup/lobby': focused(tournamentForm, 'Lobby-Basisname') },
  },
  tournaments: { default: card('Rocket-League-Cup · Runde 1', [row('Team Alex/Kim', 'gegen Sam/Jo', 'Spielbereit'), row('Lobby', 'LAN-Cup-1 · Team Alex/Kim eröffnet')], ['Ergebnis eintragen']), steps: { 'play/result': resultForm, 'play/effects': card('Tabelle nach dem Ergebnis', [row('Alex/Kim', '1 Sieg · 3 Punkte', 'Platz 1'), row('Sam/Jo', '0 Siege · 0 Punkte', 'Platz 2')]), 'play/complete': card('Rocket-League-Cup', [row('Alex/Kim', 'Alle erforderlichen Paarungen gespielt', 'Champion')]) } },
  foodOrders: {
    default: foodOrder, chapters: { pay: payment, organise: foodForm },
    steps: {
      'order/item': foodItem, 'order/quantity': focused(foodItem, 'Menge'), 'order/price': focused(foodItem, 'Einzelpreis'),
      'order/sum': card('Alex · Dein Anteil', [row('Pizza Margherita', '2 × 8,00 €', '16,00 €'), row('Trinkgeld', '10 %', '1,60 €'), row('Gesamt', 'Alle Positionen zusammen', '17,60 €')]),
      'order/freeze': payment, 'pay/paypal': form('PayPal öffnen', [field('Empfänger', 'Beispiel'), field('Betrag', '17,60 €')], ['PayPal öffnen']),
      'pay/confirm': form('Bezahlt?', [field('Pizza bei Luigi', 'Dein Anteil: 17,60 €')], ['Noch nicht', 'Ja, bezahlt']),
      'pay/remind': card('Zahlungserinnerung', [row('Alex', 'Pizza bei Luigi · 17,60 € noch offen', 'Frühestens nach 2 Stunden')]),
      'pay/close': card('Pizza bei Luigi · Geschlossen', [row('Alex', '17,60 €', 'Bezahlt'), row('Sam', '9,90 €', 'Bezahlt')], ['Wieder öffnen']),
      'organise/create': focused(foodForm, 'Titel'), 'organise/links': focused(foodForm, 'PayPal'), 'organise/tip': focused(foodForm, 'Trinkgeld in %'),
      'organise/list': card('Bestellübersicht', [row('Pizza Margherita', '2 × 8,00 €', '16,00 €'), row('Pizza Funghi', '1 × 9,00 €', '9,00 €')], ['Kopieren']),
      'organise/edit': form('Info bearbeiten', foodForm.fields.filter((item) => item.label !== 'Titel'), ['Speichern']),
      'organise/send': form('Bestellung abschicken?', [field('Bestellung', 'Pizza bei Luigi'), field('Folge', 'Positionen werden gesperrt · Nicht an Lieferdienst gesendet')], ['Abbrechen', 'Abschicken']),
      'organise/finalise': form('Bestellung schließen?', [field('Bestellung', 'Pizza bei Luigi'), field('Folge', 'Zahlungen und Bestellinformationen werden gesperrt')], ['Abbrechen', 'Schließen']),
      'organise/reopen': card('Pizza bei Luigi · Wieder öffnen', [row('Geschlossen → Abgeschickt', 'Zahlungen und Infos wieder bearbeitbar'), row('Abgeschickt → Offen', 'Positionen wieder bearbeitbar')], ['Wieder öffnen']),
    },
  },
  profile: { default: form('Mein Profil', [field('Gamertag', 'Alex'), field('Ansicht', 'Automatisch'), field('Push', false, 'checkbox')], ['Speichern']), chapters: { agent: card('Dein Agent', [row('Verbindung', 'Online'), row('Erkanntes Spiel', 'Rocket League'), row('Erfassung', 'Aktiv · Einwilligung erteilt')], ['Pausieren']), privacy: card('Meine Daten', [row('Sommer-LAN', 'Spielzeit 2 Stunden', 'Einwilligung aktiv')], ['Exportieren', 'Spielzeit löschen']) } },
  broadcast: { default: form('Durchsage schreiben', [field('Nachricht', 'Essen ist da!'), field('Sichtbar bis', 'Samstag, 20:00')], ['Senden']), steps: { 'broadcast/current': card('Aktuelle Durchsage', [row('Alex', 'Essen ist da!', 'Bis 20:00')], ['Beenden']) } },
  music: { default: card('Jetzt läuft', [row('Beispieltitel', 'Gewünscht von Alex', 'Läuft'), row('Nächster Titel', 'Gewünscht von Sam', 'Warteschlange')], ['Pausieren', 'Überspringen']), chapters: { setup: form('Controller koppeln', [field('Musikgerät', 'Musik-PC'), field('Kopplungscode', 'BEISPIEL'), field('Spotify', 'Lokal verbunden')], ['Koppeln']) } },
  myStats: { default: card('Meine Statistiken · Sommer-LAN', [row('Spielzeit', '2 Stunden'), row('Rocket League', '3 Sessions · 90 Minuten'), row('Counter-Strike 2', '1 Session · 30 Minuten')]) },
  leaderboard: { default: card('Rangliste · Sommer-LAN', [row('Alex', '2 Siege · 1 Niederlage', 'Platz 1'), row('Sam', '1 Sieg · 2 Niederlagen', 'Platz 2')]), steps: { 'ranking/record': resultForm } },
  analytics: { default: card('Statistiken · Sommer-LAN', [row('Gemeinsame Spielzeit', '12 Stunden'), row('Matches', '4 Ergebnisse'), row('Turniere', '1 abgeschlossen')]) },
  hallOfFame: { default: card('Hall of Fame', [row('Alex', 'Sommer-LAN', 'Gesamtsieg'), row('Kim und Jo', 'Rocket-League-Cup', 'Turniersieg')]) },
  seating: { default: card('Sitzplan', [row('Platz 1', 'Alex'), row('Platz 2', 'Sam'), row('Platz 3', 'Frei')], ['Person zuweisen']), steps: { 'seats/assign': form('Platz zuweisen', [field('Platz', '3'), field('Person', 'Kim')], ['Speichern']) } },
  kiosk: { default: card('Broadcast · Sommer-LAN', [row('Live-Status', 'Alex spielt Rocket League'), row('Vote', 'Laufende Abstimmung · Spiele verborgen'), row('Turnier', 'Rocket-League-Cup · Runde 1')], ['Broadcast öffnen']) },
  admin: { default: card('LAN-Bereitschaft', [row('Server und SQLite', 'Erreichbar', 'OK'), row('Agenten', '3 von 4 online', 'Prüfen'), row('Backup', 'Vor Tracking-Start erstellt', 'OK')]), chapters: { accounts: form('Einladungslink erstellen', [field('Event', 'Sommer-LAN'), field('Gültigkeit', '7 Tage')], ['Link erstellen']) } },
  adminFeatureUsage: { default: card('Nutzungsauswertung', [row('Vote', '3 Personen · Sommer-LAN'), row('Spiele bewerten', '4 Personen · alle Events')], ['Aktualisieren']) },
  adminFeedback: { default: card('Feedback-Eingang', [row('Idee · Alex', 'Mehr Spielefilter · Spiele · Sommer-LAN', 'Offen'), row('Problem · Sam', 'Ansicht auf Handy · Home', 'Erledigt')], ['Erledigt', 'Wieder öffnen']) },
  more: { default: card('Mehr', [row('Events & Gruppen', 'Arbeitsbereiche verwalten'), row('Mein Profil', 'Persönliche Einstellungen'), row('Orga', 'Umfragen · To-Do · An- & Abreise')]) },
  info: { default: card('Info', [row('WLAN', 'LAN-Gast · Beispiel-Passwort'), row('Discord', 'Einladungslink'), row('Hausregeln', 'Ab 23 Uhr bitte leise')], ['Kopieren']), steps: { 'reference/manage': form('Info anlegen', [field('Titel', 'WLAN'), field('Inhalt', 'LAN-Gast · Beispiel-Passwort')], ['Speichern']) } },
  feedback: { default: form('Feedback senden', [field('Art', 'Idee'), field('Nachricht', 'Ein weiterer Spielefilter wäre hilfreich'), field('Kontext', 'Spiele · Sommer-LAN · Laptop')], ['Senden']) },
};

export function exampleForTourStep(key, tour, step) {
  const examples = CORE_TOUR_EXAMPLES[key] ?? tour.examples;
  return examples?.steps?.[step.id] ?? examples?.chapters?.[step.id.split('/')[0]] ?? examples?.default ?? null;
}

// Native disabled controls preserve familiar form appearance without providing
// actions, navigation or mutable drafts. All strings go through the same escape.
export function tourExampleHtml(scene) {
  if (!scene) return '';
  const mark = (name) => scene.focus === name ? ' data-tour-example-focus' : '';
  const fields = (scene.fields ?? []).map((item, index) => {
    const id = `area-tour-example-field-${index}`;
    const input = item.type === 'checkbox'
      ? `<input id="${id}" type="checkbox" disabled ${item.value ? 'checked' : ''} />`
      : `<input id="${id}" type="text" disabled value="${escapeHtml(item.value)}" />`;
    return `<div${mark(item.label)}><label class="field-label" for="${id}">${escapeHtml(item.label)}</label>${input}</div>`;
  }).join('');
  const rows = (scene.rows ?? []).map((item) => `<div class="stack"${mark(item.title)}>
    <strong>${escapeHtml(item.title)}</strong><span class="muted">${escapeHtml(item.detail)}</span>
    ${item.badge ? `<small>${escapeHtml(item.badge)}</small>` : ''}
  </div>`).join('');
  const actions = (scene.actions ?? []).map((label) => `<button type="button" class="btn btn-sm" disabled>${escapeHtml(label)}</button>`).join('');
  return `<section class="area-tour-example" data-tour-example aria-label="Beispiel: ${escapeHtml(scene.title)}">
    <p class="muted">${scene.kind === 'dialog' ? 'Beispieldialog' : 'Beispiel'} · Nur zur Erklärung</p>
    <h3>${escapeHtml(scene.title)}</h3>
    <div class="stack">${fields}${rows}</div>
    ${scene.note ? `<p class="muted">${escapeHtml(scene.note)}</p>` : ''}
    ${actions ? `<div class="area-tour-actions">${actions}</div>` : ''}
  </section>`;
}
