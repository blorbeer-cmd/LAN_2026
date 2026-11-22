// "So funktionieren LAN-Punkte": the rules page of the points view. Every
// number comes from the server's rule set (`GET /api/points` → `rules`), the
// same record each final standing stores, so the page cannot drift from the
// values that are actually booked.

import { escapeHtml } from './format.js';
import { rankedListHtml } from './rankedList.js';

const e = escapeHtml;

function points(value) {
  return `${value} P.`;
}

function section(key, title, body) {
  return `<section class="card stack grouped-page-section" aria-labelledby="points-rules-${key}" data-points-rules-section="${key}">
    <div class="grouped-page-section-title"><h2 id="points-rules-${key}">${e(title)}</h2></div>${body}</section>`;
}

function list(label, rows) {
  return rankedListHtml(rows.map((row) => ({
    title: e(row.title), meta: row.meta ? e(row.meta) : '', value: e(row.value), sortKey: row.sortKey,
  })), { label });
}

function placeOrdinal(place, count) {
  return place === count ? 'der letzte Platz' : `Platz ${place}`;
}

function totalSection(participantCount, prizeInfo) {
  const n = Math.max(0, Number(participantCount) || 0);
  const example = n >= 2
    ? ` Bei aktuell ${n} Teilnehmenden bringt Platz 1 also ${points(n)}, ${placeOrdinal(n, n)} ${points(1)}`
    : '';
  return section('total', 'Gesamtwertung', `
    <p>Gewertet werden drei Kategorien: Orga, Spielen und Wetten. In jeder Kategorie bekommst du einen Platz, und jeder Platz bringt Platzpunkte. Die Summe deiner Platzpunkte ist dein Gesamtstand.</p>
    <p>Bei N Teilnehmenden bringt Platz 1 N Platzpunkte, jeder weitere Platz einen weniger.${e(example)}</p>
    <p>Einen Platz bekommt nur, wer in der Kategorie mehr als 0 Punkte hat. Gleiche Punkte teilen sich den besseren Platz, zum Beispiel 1, 2, 2, 4. Dein Wettguthaben zählt nicht zur Wertung, nur dein Wettgewinn.</p>
    ${prizeInfo ? `<p><strong>Preis:</strong> ${e(prizeInfo)}</p>` : ''}`);
}

function orgaSection(rules) {
  const o = rules.orga;
  const food = o.foodOrderByOtherParticipants;
  return section('orga', 'Orga-Punkte', `
    <p>Orga-Punkte gibt es für alles, was die LAN für andere organisiert.</p>
    ${list('Orga-Punkte je Aktion', [
      { title: 'Fremdes To-do erledigt', meta: 'Übernommen und erledigt, für den ersten Helfer; eigene To-dos und Mitbring-Anfragen zählen nicht', value: points(o.completedForeignTodo) },
      { title: 'Match organisiert', meta: 'Für den Ersteller, sobald ein Ergebnis eingetragen ist', value: points(o.organizedMatch) },
      { title: 'Turnier organisiert', meta: 'Für den Ersteller, wenn das Turnier regulär abgeschlossen wird', value: points(o.completedTournament) },
      { title: 'Sammelbestellung', meta: `Abgeschickt, für den Organisator nach Zahl anderer Besteller: ${food.minimum}–5: ${points(food.threeToFive)}, 6–8: ${points(food.sixToEight)}, ab 9: ${points(food.nineOrMore)}`, value: `${food.threeToFive}–${points(food.nineOrMore)}` },
      { title: 'Eigene Bestellung', meta: 'Je abgeschickter Sammelbestellung, unabhängig von der Menge', value: points(o.ownFoodOrder) },
      { title: 'Skills vollständig', meta: 'Alle Katalogspiele eingeschätzt, einmalig je LAN', value: points(o.completeSkills) },
      { title: 'Ankunft eingetragen', meta: 'Wenn sie bis zum Eventstart eingetragen ist', value: points(o.arrivalBeforeStart) },
      { title: 'Abreise eingetragen', meta: 'Wenn sie bis zum Eventstart eingetragen ist', value: points(o.departureBeforeStart) },
      { title: 'Umfrage abgeschlossen', meta: `Für den Ersteller, ab ${o.minimumRespondents} Antwortenden`, value: points(o.completedPoll) },
      { title: 'Vote abgeschlossen', meta: `Spieleabstimmung, für den Ersteller, ab ${o.minimumRespondents} Abstimmenden`, value: points(o.completedGameVote) },
    ])}`);
}

function playingSection(rules) {
  const match = rules.matchPointsByPosition;
  const tournament = rules.tournamentPlacementPoints;
  const last = match.length;
  return section('playing', 'Spielpunkte', `
    <p>Für jedes Match mit eingetragenem Ergebnis bekommt jedes Teammitglied die Punkte seines Platzes. Spielstand, Teamgröße und Spieldauer spielen keine Rolle.</p>
    ${list('Spielpunkte je Matchplatz', match.map((value, index) => index === last - 1
      ? { title: `Platz ${index + 1} und dahinter`, meta: `Der letzte Platz bringt immer ${points(rules.lastMatchPlacePoints)}, bei zwei Teams also ${points(match[0])} und ${points(rules.lastMatchPlacePoints)}`, value: points(value) }
      : { title: `Platz ${index + 1}`, value: points(value) }))}
    <p>Bei Gleichstand gibt es den abgerundeten Durchschnitt der belegten Plätze (Unentschieden zu zweit: je ${points(Math.floor((match[0] + rules.lastMatchPlacePoints) / 2))}). Spiele ohne Ergebnis zählen nicht.</p>
    <p>Wird ein Turnier regulär abgeschlossen, gibt es zusätzlich je Teammitglied:</p>
    ${list('Turnierbonus je Platz', tournament.map((value, index) => ({
      title: `Turnier Platz ${index + 1}`,
      meta: index === 2 ? 'Nur mit Spiel um Platz 3 oder in Ligen' : '',
      value: `+${points(value)}`,
    })))}`);
}

function bettingSection(rules) {
  return section('betting', 'Wetten', `
    ${list('Wetten in Zahlen', [
      { title: 'Wettguthaben zum Start', meta: 'Einmalig je LAN, getrennt von der Wertung', value: points(rules.walletStart) },
      { title: 'Höchsteinsatz je Wette', meta: 'Ein Tipp pro Wette', value: points(rules.maximumStake) },
      { title: 'Tipps für Wettplatz', meta: 'Regulär abgerechnete Tipps; erstattete und zurückgenommene zählen nicht', value: `mind. ${rules.minimumSettledTips}` },
    ])}
    <ol class="stack points-rules-steps">
      <li><strong>Tippen:</strong> Auf Matches, bei denen der Ersteller Wetten erlaubt hat, auf einzelne Turnierspiele und auf den Turniersieger. Du darfst auch auf dich oder dein eigenes Team tippen; wo angeboten, auch auf Unentschieden.</li>
      <li><strong>Ändern:</strong> Bis die Tipps schließen, kannst du Team und Einsatz ändern oder den Tipp zurücknehmen. Die Tipps schließen mit „Spiel starten“, spätestens mit dem Ergebnis.</li>
      <li><strong>Abrechnung:</strong> Der Topf besteht nur aus den Einsätzen. Gewinner bekommen ihren Einsatz zurück und gewinnen höchstens noch einmal so viel dazu; übrige Einsätze gehen anteilig zurück. Beispiel: 1 P. auf Team A, 15 P. auf Team B, A gewinnt: A bekommt 2 P., B bekommt 14 P. zurück. Gerundet wird auf ganze Punkte.</li>
      <li><strong>Erstattung:</strong> Hat niemand auf das Ergebnis getippt, wurde nur auf eine Seite getippt, endet ein Spiel unentschieden ohne Remis-Tipp, wird es abgebrochen oder ändert sich die Aufstellung, bekommt jeder seinen Einsatz zurück.</li>
    </ol>
    <p>In der Kategorie Wetten zählt dein Nettogewinn aus allen abgerechneten Wetten. Einen Platz bekommst du ab ${e(rules.minimumSettledTips)} regulär abgerechneten Tipps mit positivem Netto.</p>`);
}

function timingSection() {
  return section('timing', 'Wann gebucht wird', `
    <p>Punkte werden automatisch gebucht, sobald ein Ergebnis eingetragen, eine Aufgabe erledigt oder eine Bestellung abgeschickt ist. Wird etwas wieder geöffnet, korrigiert oder gelöscht, rechnet die App den Anspruch neu.</p>
    <p>Am Ende schreibt ein Admin die Endwertung fest. Noch nicht abgerechnete Wetten werden dann vollständig erstattet, danach ändern sich keine Punkte mehr.</p>
    <p>Stimmt eine Buchung nicht, meldest du sie in den Buchungs- oder Tippdetails über „Punktefehler melden“.</p>`);
}

// `data` is the `GET /api/points` payload; without its rule set the caller
// keeps showing its loading or error state.
export function pointsRulesHtml(data) {
  const rules = data?.rules;
  if (!rules) return '';
  return `<div class="grouped-page-sections points-rules">
    ${totalSection(data.participantCount, data.settings?.prize_info)}
    ${orgaSection(rules)}${playingSection(rules)}${bettingSection(rules)}${timingSection()}</div>`;
}
