// Short, read-only explanations. Targets are existing controls, never actions
// to invoke. Missing targets use an explicitly labelled example in the dialog.
const s = (id, title, text, target = '', options = {}) => ({ id, title, text, target, ...options });
const c = (id, title, steps, options = {}) => ({ id, title, steps, ...options });
const t = (title, chapters, options = {}) => ({ title, chapters, ...options });

export const AREA_TOURS = {
  home: t('Home', [
    c('overview', 'Überblick', [
      s('current', 'Was läuft gerade?', 'Aktuell führt dich zu laufenden Abstimmungen, Turnieren, Bestellungen und Arcade-Lobbys. Erledigte Vorgänge findest du im jeweiligen Bereich wieder.', '#home-current-title'),
      s('todos', 'Deine nächsten Schritte', 'Meine To-Dos sammelt offene Einladungen, Zahlungen und Aufgaben aus deinen Events. Eine Zeile führt zum Vorgang; manche Aufgaben kannst du direkt erledigen.', '#home-todos-title'),
      s('other-event', 'Auch aus anderen Events', 'Ein Eventname an einem To-Do zeigt dessen Herkunft. Öffnest du den Vorgang, wechselt Respawn bei Bedarf zuerst in dieses Event.', '[data-home-todo]'),
      s('live', 'Wer spielt gerade?', 'Live-Status unterscheidet Spielt, Online, Pause und Offline. Tippe auf eine Person für deren Profil; deine eigene Karte öffnet Mein Profil.', '#home-live-title', { feature: 'tracking' }),
      s('pause', 'Persönliche Pause', 'Pause zeigt den anderen, dass du gerade nicht mitspielst. Bin wieder da hebt sie auf. Die Agent-Erfassung pausierst du separat im Profil.', '[data-toggle-pause]', { feature: 'tracking' }),
      s('event', 'Dein Event im Blick', 'Die Eventübersicht zeigt Zeitraum, Ort und Teilnahme. Welche weiteren Karten erscheinen, hängt vom Eventtyp und den aktivierten Bereichen ab.', '[data-home-event-overview]'),
    ]),
    c('context', 'Navigation und Event', [
      s('workspace', 'Hier arbeitest du gerade', 'Der Eventname oben bestimmt den Arbeitsbereich. Bestellungen, Aufgaben und Wettbewerbe gehören zu diesem Event; ein Wechsel ändert die angezeigten Daten.', '#event-context'),
      s('account', 'Eine Auswahl für dein Konto', 'Der Arbeitsbereich gilt für dein Konto, auch in anderen Tabs und auf anderen Geräten. Eine offene Einladung musst du vor dem vollständigen Zugriff annehmen.', '#event-context'),
      s('types', 'Passende Bereiche', 'LAN, allgemeines Event und dauerhafte Gruppe bieten unterschiedliche Bereiche. Deine Rolle und die Eventeinstellungen bestimmen, welche Aktionen du siehst.', '#event-context'),
      s('shared', 'Spielewerte bleiben erhalten', 'Spielekatalog, Bock und Skill werden innerhalb eurer Community weiterverwendet. Ein Eventwechsel beginnt diese Bewertungen nicht neu.', '#event-context', { feature: 'games' }),
      s('search', 'Direkt zum richtigen Eintrag', 'Die Suche findet Bereiche und Inhalte. Mit Strg oder Cmd plus K öffnest du sie; ein Treffer führt zum passenden Eintrag.', '#global-search-btn'),
    ]),
    c('notifications', 'Benachrichtigungen', [
      s('center', 'Deine Mitteilungen', 'Das Benachrichtigungszentrum sammelt persönliche und gemeinsame Mitteilungen. Push zeigt sie zusätzlich auf erlaubten Geräten; eine kurze Einblendung informiert dich in der App.', '#notifications-btn'),
      s('open', 'Zum Vorgang springen', 'Öffnen markiert die Nachricht als gelesen und führt zum zugehörigen Vorgang. Bei Bedarf wird zuerst dessen Event ausgewählt.', '#notifications-btn'),
      s('read', 'Gelesen heißt noch offen', 'Eine gelesene Nachricht erledigt keine Zahlung oder Aufgabe. Erst die passende Aktion im Vorgang beendet dessen offenen Zustand.', '#notifications-btn'),
      s('obsolete', 'Obsolet oder abgelaufen', 'Erledigte Themen werden obsolet, zeitlich begrenzte Nachrichten laufen ab. Aufräumen entfernt solche Hinweise; der zugrunde liegende Vorgang bleibt erhalten.', '#notifications-btn'),
      s('push', 'Push erlauben', 'Push aktivierst du im Profil und im Browser. Ob eine Benachrichtigung auf dem Gerät erscheint, hängt außerdem von dessen Berechtigungen ab.', '#notifications-btn'),
    ]),
  ]),
  events: t('Events & Gruppen', [
    c('participate', 'Teilnehmen, Kalender und Beitrag', [
      s('invitation', 'Einladung prüfen', 'Prüfe Zeitraum, Ort, Beitrag und Zahlungsfrist vor deiner Zusage. Das Öffnen der Einladung nimmt sie noch nicht an.', '[data-accept-invitation], [data-event-card]'),
      s('accept', 'Zusagen und öffnen', 'Zusagen bestätigt deine Teilnahme. Event öffnen wählt anschließend den Arbeitsbereich. Deine Verwaltungsrolle und deine persönliche Teilnahme sind getrennte Entscheidungen.', '[data-accept-invitation], [data-event-card]'),
      s('calendar', 'In deinen Kalender übernehmen', 'Google, Outlook und die ICS-Datei übergeben den Termin an deinen Kalender. Respawn kann nicht automatisch erkennen, ob du ihn dort gespeichert hast.', '[data-event-calendar], [data-event-card]'),
      s('confirm', 'Eingetragen bestätigen', 'Bestätige den gespeicherten Termin mit Eingetragen. Kalender-Erinnerungen beginnen frühestens nach zwei Stunden und wiederholen sich wöchentlich, bis du bestätigst.', '[data-event-card]'),
      s('moved', 'Bei einem neuen Zeitraum', 'Deine Zusage bleibt bei einer Terminänderung bestehen. Prüfe aber den Kalendereintrag und bestätige den neuen Zeitraum erneut. Eventhinweise vor dem Start bleiben unabhängig davon aktiv.', '[data-event-card]'),
      s('payment', 'Deinen Beitrag bezahlen', 'PayPal öffnet den hinterlegten Empfänger. Erst deine Antwort auf Bezahlt? erfasst die Zahlung in Respawn; das Öffnen von PayPal allein genügt nicht.', '[data-pay-event], [data-event-card]'),
      s('reminders', 'Offener Beitrag', 'Home zeigt deinen offenen Beitrag. Erinnerungen beginnen ab Zahlungsfrist, sonst frühestens zwei Stunden nach Zusage. Sie werden höchstens alle zwei Stunden erneut fällig.', '[data-event-card]'),
      s('decline', 'Teilnahme ändern', 'Du kannst eine Teilnahme nach Möglichkeit absagen und später wieder zusagen. Erfasste Zahlungen oder der Eventzustand können das sperren; die Karte nennt den Grund.', '[data-event-card]'),
      s('excuse', 'Mit Ausrede absagen', 'Für kommende Events kannst du eine Ausrede ergänzen. Sie wird mit deiner Absage gespeichert und ist für die entsprechenden Eventteilnehmer sichtbar.', '[data-event-card]'),
    ]),
    c('organise', 'Event organisieren', [
      s('create', 'Event oder Gruppe anlegen', 'Events planen einen Anlass; Gruppen dienen dem dauerhaften Austausch. Lege Name, Zeitraum und die benötigten Bereiche fest. Der Ersteller nimmt zunächst automatisch teil.', '#new-event-btn, #new-group-btn'),
      s('invite', 'Teilnehmer einladen', 'Einladen versendet eine persönliche Mitteilung. Eingeladen, zugesagt und abgesagt sind unterschiedliche Zustände; vollständige Eventfunktionen setzen eine bestätigte Teilnahme voraus.', '[data-invite-participant]'),
      s('costs', 'Beitrag und Rechnung', 'Der Beitrag pro Person ist getrennt von der gesamten Unterkunftsrechnung. Die Abrechnung vergleicht erfasste Beiträge mit den Kosten und zeigt die erwartete Differenz.', '[data-event-card]'),
      s('paid', 'Zahlungen festhalten', 'Berechtigte Personen bestätigen oder korrigieren Zahlungen. Eine bezahlte Teilnehmerzeile kann erst nach dem Zurücksetzen der Zahlung entfernt werden.', '[data-event-card]'),
      s('changes', 'Änderungen mitteilen', 'Wichtige Änderungen wie Zeitraum, Ort oder Beitrag informieren die Betroffenen. Ein Umfrageergebnis übernimmt diese Änderungen nicht automatisch.', '[data-event-card]'),
      s('tracking', 'Tracking bewusst starten', 'Tracking benötigt einen passenden Arbeitsbereich und die Einwilligung der jeweiligen Person. Vor einem Tracking-Start erstellt Respawn ein Backup.', '[data-event-card]', { feature: 'tracking' }),
      s('end', 'Event abschließen', 'Ein abgelaufener Zeitraum beendet das Event nicht automatisch. Beenden verschiebt es in die Historie und ändert die Verfügbarkeit weiterer Aktionen.', '[data-event-card]'),
    ], { adminOnly: true }),
  ]),
  eventPolls: t('Umfragen', [
    c('answer', 'Antworten', [
      s('scope', 'Gemeinsam planen', 'Hier beantwortet ihr Fragen zum aktiven Event. Sichtbarkeit und Abstimmen setzen bestätigte Teilnahme voraus, auch für Admins.', '.event-poll-card'),
      s('modes', 'Die Antwortart beachten', 'Eine Umfrage fragt nach Passt, Notfalls oder Nein, einer Auswahl, mehreren Optionen oder einer Bewertung von 0 bis 5.', '.event-poll-card'),
      s('save', 'Antwort speichern', 'Speichere deine vollständige Antwort. Eine 0 ist eine bewusste Bewertung; eine unbeantwortete Option bleibt offen.', '.event-poll-card'),
      s('visibility', 'Anonym und verborgen', 'Anonyme Umfragen zeigen keine Zuordnung zu Personen. Bei verborgenem Zwischenstand sehen während der Runde nur die verwaltenden Personen die Ergebnisse.', '.event-poll-card'),
      s('changed', 'Neue Optionen beachten', 'Neue Optionen können eine vollständige Antwort wieder unvollständig machen. Betroffene erhalten einen Hinweis und können die fehlenden Antworten ergänzen.', '.event-poll-card'),
      s('result', 'Ergebnis und Eventdaten', 'Das Ergebnis hilft bei der Entscheidung. Es ändert keinen Termin, Ort oder Beitrag automatisch; Organisatoren tragen die Entscheidung anschließend beim Event ein.', '.event-poll-card'),
    ]),
    c('manage', 'Umfrage verwalten', [
      s('start', 'Umfrage starten', 'Bestätigte Teilnehmer dürfen eine Umfrage erstellen. Wähle Antwortart, Optionen, Anonymität und die Sichtbarkeit des Zwischenstands.', '#new-event-poll'),
      s('deadline', 'Frist und Erinnerungen', 'Mit einer Frist werden fehlende Antworten 48 und zwei Stunden vorher erinnert. Ohne Frist gibt es diese automatischen Erinnerungen nicht.', '.event-poll-card'),
      s('manual', 'Gezielt erinnern', 'Als Ersteller kannst du ausstehende Antworten manuell erinnern. Wiederholungen aktualisieren den vorhandenen Hinweis pro Person statt neue Einträge anzuhäufen.', '.event-poll-card'),
      s('options', 'Optionen ändern', 'Deaktivieren erhält bisherige Stimmen, verhindert aber neue Antworten und einen Sieg. Löschen entfernt auch die Stimmen dieser Option und benötigt eine Bestätigung.', '.event-poll-card'),
      s('close', 'Runde abschließen', 'Beenden veröffentlicht das Ergebnis. Nach Ablauf einer Frist wird die Runde geschlossen; Antworten lassen sich dann nicht mehr ändern.', '.event-poll-card'),
      s('round', 'Weitere Runde', 'Wieder öffnen setzt die Runde fort. Neue Runde übernimmt aktive Optionen für einen neuen Durchgang; frühere Runden bleiben in der Historie erhalten.', '.event-poll-card'),
    ]),
  ]),
  arrivals: t('An- & Abreise', [c('travel', 'Zeiten und Fahrgemeinschaften', [
    s('mine', 'Eigene Zeiten speichern', 'Trage Ankunft, Abreise und eine Notiz ein. Vorbelegte Eventzeiten sind zunächst Formularvorschläge und werden erst mit Speichern übernommen.', '#arrival-form'),
    s('all', 'Alle Zeiten vergleichen', 'Alle Zeiten zeigt die bestätigten Teilnehmer. Fehlende Angaben bleiben offen; mit Fahrername kennzeichnet eine Fahrgemeinschaft.', '#arrivals-times-title'),
    s('offer', 'Fahrt anbieten', 'Anreise und Abreise haben getrennte Fahrgemeinschaften. Freie Plätze zählt nur die Mitfahrer; als Fahrer bist du zusätzlich dabei.', '[data-carpool-direction]'),
    s('join', 'Einen Platz nehmen', 'Du kannst je Richtung nur eine Fahrt fahren oder mitfahren. Eintragen übernimmt bei der Anreise die Ankunft, bei der Abreise die Startzeit in deine Angaben.', '[data-join-carpool], [data-carpool-direction]'),
    s('edit', 'Fahrtdaten prüfen', 'Der Fahrer kann Zeiten, Startort und Plätze ändern. Prüft danach die persönlichen Angaben; eine nachträgliche Änderung aktualisiert nicht automatisch alle Mitfahrerzeiten.', '[data-edit-carpool], [data-carpool-direction]'),
    s('leave', 'Austragen oder löschen', 'Austragen leert die entsprechende übernommene Zeit. Löscht der Fahrer die Fahrt, werden die betroffenen Zeitangaben ihrer Mitglieder geleert.', '[data-leave-carpool], [data-carpool-direction]'),
    s('todo', 'Anreise noch offen?', 'Für ein zugesagtes Event innerhalb der nächsten 14 Tage kann Home eine fehlende Anreise als To-Do anzeigen. Speichere deine Zeiten im passenden Event.', '#arrival-form'),
  ])]),
  checklistPacking: t('Packliste', [c('packing', 'Persönlich packen', [
    s('private', 'Deine Liste für dieses Event', 'Die Packliste ist persönlich und eventbezogen. Ein neues Event beginnt mit einer eigenen Liste; Änderungen betreffen keine anderen Personen.', '#checklist-packing-title'),
    s('defaults', 'Grundstock und Ergänzungen', 'Beim ersten Öffnen erhältst du einen Grundstock. Ergänze eigene Dinge; entfernte Standardpositionen werden später nicht einfach wieder eingefügt.', '#checklist-packing-title'),
    s('check', 'Einpacken markieren', 'Abhaken aktualisiert deinen Fortschritt. Der Eintrag bleibt an seiner Stelle und wird durchgestrichen angezeigt.', '[data-toggle-item]'),
    s('edit', 'Liste bearbeiten', 'Bearbeiten zeigt die Entfernen-Aktionen. Mit Fertig verlässt du den Bearbeitungsmodus; Abhaken funktioniert in beiden Ansichten.', '#checklist-packing-title'),
    s('requests', 'Mitbringen getrennt planen', 'Eine übernommene Mitbring-Anfrage steht im gemeinsamen To-Do-Bereich. Sie wird nicht automatisch als Eintrag in deine Packliste kopiert.', '#checklist-packing-title'),
  ])]),
  checklist: t('To-Do', [c('tasks', 'Aufgaben und Mitbringen', [
    s('pool', 'Gemeinsamer Aufgabenpool', 'Aufgaben und Mitbring-Anfragen gehören zum aktiven Event. Home sammelt daraus deine offenen Verpflichtungen unter Meine To-Dos.', '#checklist-task-search'),
    s('create', 'To-Do erstellen', 'Wähle Aufgabe oder Mitbring-Anfrage, ergänze Titel, Beschreibung und bei Bedarf eine Fälligkeit. Neue Einträge starten ohne zugewiesene Person.', '#checklist-new-todo-btn'),
    s('claim', 'Übernehmen', 'Übernehmen trägt dich mit optionalem Kommentar ein. Mehrere Personen können dieselbe Aufgabe übernehmen; der Ersteller wird über fremde Übernahmen informiert.', '[data-claim-task]'),
    s('release', 'Wieder abgeben', 'Abgeben entfernt nur deine Beteiligung. Gibt die letzte Person ab, steht die Aufgabe wieder offen im gemeinsamen Pool.', '[data-release-task]'),
    s('due', 'Fälligkeit verstehen', 'Die Fälligkeit steuert Hinweise wie Heute oder Überfällig. Sie erzeugt keine allgemeine wiederkehrende Push-Erinnerung.', '[data-checklist-task]'),
    s('done', 'Erledigen und archivieren', 'Erledigt schließt den gemeinsamen Vorgang ab. Archivieren verschiebt den abgeschlossenen Eintrag anschließend in die Historie.', '[data-task-detail]'),
    s('packing', 'Packliste bleibt persönlich', 'Eine Mitbring-Anfrage ergänzt deine Packliste nicht automatisch. Trage das benötigte Teil dort bei Bedarf selbst ein.', '#checklist-new-todo-btn'),
  ])]),
  gameCatalog: t('Spiele', [
    c('ratings', 'Bock, Skill und Auswahl', [
      s('tabs', 'Katalog oder Vorschlag', 'Katalog enthält freigegebene Spiele. Vorschläge können bereits bewertet werden, stehen aber noch nicht für neue Votes, Auslosungen oder Turniere zur Auswahl.', '[data-tab]'),
      s('bock', 'Bock bewerten', 'Bock beschreibt deine Lust auf das Spiel. Der Wert beeinflusst Durchschnitt, Top 10 und die Vorbelegung neuer Stimmzettel.', '[data-kind="bock"]'),
      s('skill', 'Skill bewerten', 'Skill unterstützt die automatische Teamverteilung. 0 bedeutet nie gespielt und zählt als 0; eine fehlende Bewertung verwendet bei der Auslosung den Ersatzwert 3.', '[data-kind="skill"]'),
      s('save', 'Direkt gespeichert', 'Ein Druck auf eine Zahl speichert die persönliche Wertung sofort. Keine Zahl bedeutet noch unbewertet; 0 ist eine bewusste Bewertung.', '[data-rating-value]'),
      s('suggestion', 'Skill-Vorschlag übernehmen', 'Aus erfassten Spielergebnissen kann ein Skill-Vorschlag entstehen. Erst wenn du ihn antippst, ersetzt er deine eigene Wertung.', '[data-apply-suggestion]'),
      s('filters', 'Offene Bewertungen finden', 'Bock offen und Skill offen zeigen fehlende Wertungen. Beide zusammen verlangen, dass beide Werte fehlen; ausgewählte Genres werden dagegen alternativ berücksichtigt.', '#game-catalog-search'),
    ]),
    c('catalog', 'Spiele vorschlagen und pflegen', [
      s('propose', 'Spiel vorschlagen', 'Ergänze Titel, Plattform, Links, Genres und Hinweise. Die Community kann Bock und Skill bereits vor der Freigabe bewerten.', '#suggest-new'),
      s('details', 'Spieldetails ansehen', 'Der Spielname öffnet die Details. Plattform- und Gameplay-Links helfen bei der Entscheidung; zusätzliche Hinweise erklären Besonderheiten des Spiels.', '.game-row-detail-trigger'),
      s('promote', 'Für neue Runden freigeben', 'Berechtigte Personen übernehmen Vorschläge in den Katalog. Danach erscheint das Spiel in den Auswahlen für neue Abstimmungen und Matches.', '.game-row-detail-trigger', { adminOnly: true }),
      s('process', 'Automatische Erkennung', 'Admins pflegen die Prozessnamen zentral. Der Agent erhält diese Zuordnungen vom Server; die Teilnehmer müssen ihre Installation dafür nicht neu einrichten.', '.game-track-indicator', { adminOnly: true, feature: 'tracking' }),
      s('history', 'Historie bleibt zugeordnet', 'Ein zurückgestuftes Spiel behält seine bestehenden Ergebnisse. Laufende Votes behalten ihre ursprüngliche Spieleauswahl; neue Runden verwenden den aktuellen Katalog.', '.game-row-detail-trigger'),
    ]),
  ]),
  votes: t('Vote', [
    c('vote', 'Abstimmen und Bock übernehmen', [
      s('start', 'Eine Runde starten', 'Jedes Mitglied kann eine Runde starten. Die Spieleauswahl beginnt mit den Top 10 nach Bock; Suche und Filter ändern nur die sichtbaren Zeilen.', '#votes-new'),
      s('prefill', 'Bock als Entwurf', 'Deine vorhandenen Bock-Werte sind vorgewählt. Noch zählt keine Stimme: Erst Speichern gibt den vollständigen Stimmzettel ab.', '.event-poll-card'),
      s('zero', 'Jedes Spiel bewerten', 'Bewerte alle Spiele von 0 bis 5. 0 heißt Spiele ich nicht; ohne ausgewählte Zahl fehlt die Antwort.', '.rating-scale'),
      s('adopt', 'Bock übernehmen', 'Mit Bock übernehmen werden die Stimmen zusätzlich als persönliche Bock-Werte im Katalog gespeichert. Ohne Häkchen gelten sie nur für diese Runde.', '[data-vote-adopt-bock]'),
      s('anonymous-adopt', 'Anonymität und Bock', 'Auch in einer anonymen Runde kannst du Bock übernehmen. Die Stimmabgabe bleibt anonym; die übernommenen persönlichen Bock-Werte werden im Katalog sichtbar.', '.event-poll-card'),
      s('replace', 'Stimme ändern', 'Solange die Runde läuft, kannst du erneut speichern. Die neue Stimmabgabe ersetzt deine vorherige vollständig.', '.event-poll-card'),
      s('hidden', 'Zwischenstand verstehen', 'Bei verborgenem Zwischenstand bleiben die Verteilung und Einzelstimmen während der Runde verborgen. Nach dem Ende erscheinen Ergebnisse; anonyme Runden nennen keine Personen.', '.event-poll-card'),
    ]),
    c('result', 'Ergebnis, Stichwahl und Match', [
      s('close', 'Runde beenden', 'Der Starter oder ein Community-Admin kann die Runde beenden. Dann stehen Gewinner, Punkte und Teilnahme fest; Gleichstände teilen sich den Platz.', '.event-poll-card'),
      s('runoff', 'Stichwahl starten', 'Bei Gleichstand können Community-Admins eine Stichwahl öffnen. Sie fragt nach genau einem Spiel und übernimmt Anonymität und Zwischenstandseinstellung der Vorrunde.', '#votes-runoff'),
      s('match', 'Match vorbereiten', 'Match generieren übernimmt das gewählte Gewinner-Spiel und passende Teilnehmer in die Auslosung. Du kannst die Auswahl noch ändern; die Teams werden nicht sofort ausgelost.', '[data-generate-vote-match], #votes-generate-match'),
      s('players', 'Welche Spieler kommen mit?', 'In der Punkterunde werden Personen mit mindestens einem Punkt für den Gewinner übernommen. Nach einer Stichwahl werden dessen Ablehnungen aus der zugehörigen Vorrunde berücksichtigt.', '[data-generate-vote-match], #votes-generate-match'),
      s('limits', 'Grenzen der Übernahme', 'Anonyme Runden bieten keine personenbezogene Match-Übernahme. Ein laufender Captain Draft wird durch einen Vote-Einstieg nicht überschrieben.', '[data-generate-vote-match], #votes-generate-match'),
      s('history', 'Später wiederfinden', 'Letzter Vote und Historie behalten abgeschlossene Ergebnisse. Top 10 zeigt dagegen die aktuellen Bock-Werte aus dem Katalog.', '.vote-page-section'),
    ]),
  ]),
  matchmaking: t('Match', [
    c('draw', 'Teams auslosen', [
      s('game', 'Spiel und Teilnehmer', 'Wähle ein Katalogspiel und die Mitspieler. Suche blendet Personen nur aus; bereits ausgewählte Personen bleiben ausgewählt.', '#mm-game, #matchmaking-game'),
      s('balance', 'Nach Skill ausgleichen', 'Die Auslosung verwendet den Skill des gewählten Spiels. Fehlende Werte zählen mit 3, eine eingetragene 0 mit 0.', '.tournament-player-grid'),
      s('neighbors', 'Sitznachbarn berücksichtigen', 'Sichtbare Monitore und Nachbarn helfen, Einblick in gegnerische Teams zu vermeiden. Verbleibende Konflikte werden nach der Auslosung genannt.', '#mm-avoid-adjacent'),
      s('teams', 'Aufstellung anpassen', 'Nach dem Auslosen kannst du Spieler verschieben. Auf dem Handy gibt es dafür eine Team-Auswahl; die Teamnamen folgen der aktuellen Besetzung.', '[data-draw-card]'),
      s('next', 'Ergebnis oder Turnier', 'Eine Aufstellung wird entweder als einzelnes Match gewertet oder für ein Turnier verwendet. Turnier erstellen übernimmt die vorhandenen Teams.', '[data-draw-tournament]'),
      s('result', 'Ergebnis speichern', 'Ein gespeichertes Ergebnis erscheint in Historie und Rangliste und kann spätere Skill-Vorschläge beeinflussen. Ergebnis bearbeiten korrigiert den vorhandenen Eintrag.', '[data-record-draw], [data-edit-draw-result]'),
      s('snapshot', 'Werte zum Auslosungszeitpunkt', 'Gespeicherte Auslosungen behalten ihre verwendeten Skill-Werte. Eine spätere Selbstbewertung verändert diese historische Aufstellung nicht rückwirkend.', '[data-draw-card]'),
    ]),
    c('draft', 'Captain Draft', [
      s('mode', 'Captains wählen Teams', 'Beim Captain Draft wählen Captains ihre Mitspieler. Skill-Werte helfen bei der Entscheidung, steuern die Auswahl aber nicht automatisch.', '[data-mm-mode="draft"]'),
      s('roster', 'Teilnehmer vorbereiten', 'Wähle Spieler und daraus zwei bis vier Captains. Zum Start muss mindestens eine weitere Person im Spielerpool bleiben.', '.tournament-player-grid'),
      s('order', 'Abwechselnde Richtung', 'Die Auswahlrichtung wechselt nach jeder Runde. Bei zwei Captains lautet die Reihenfolge A, B, B, A; der aktuelle Zug wird angezeigt.', '.draft-pool-player'),
      s('live', 'Ein gemeinsamer Stand', 'Jeder Pick aktualisiert Teams und Spielerpool auf den verbundenen Geräten. Nur der gerade berechtigte Captain kann auswählen.', '.draft-pool-player'),
      s('finish', 'Aufstellung weiterverwenden', 'Der fertige Draft wird zur neuen Aufstellung. Daraus erfasst ihr ein Ergebnis oder erstellt ein Turnier.', '[data-draw-card]'),
      s('cancel', 'Draft abbrechen', 'Ein laufender Draft blockiert konkurrierende Match-Übernahmen. Abbrechen beendet ihn nach Bestätigung; ein Vote bricht ihn niemals automatisch ab.', '#draft-cancel'),
    ]),
    c('tournament-setup', 'Turnier erstellen', [
      s('take', 'Aufstellung übernehmen', 'Turnier erstellen übernimmt Spiel und Teams aus einer Auslosung oder einem fertigen Draft. Die Aufstellung kann anschließend kein separates Einzelresultat mehr erhalten.', '[data-draw-tournament]'),
      s('format', 'Format und Optionen', 'Wähle K.O., Liga oder Gruppenphase mit K.O. Hin- und Rückrunde sowie Spiel um Platz 3 stehen je nach Format zur Verfügung.', '[data-draw-tournament]'),
      s('names', 'Namen und Punktestand', 'Benenne die Teams und entscheide, ob Ergebnisse einen Punktestand erfassen. Die Einstellung legt die Ergebnisformulare des Turniers fest.', '[data-draw-tournament]'),
      s('lobby', 'Lobbyangaben weitergeben', 'Ein Lobby-Basisname erhält pro Paarung einen eindeutigen Zusatz. Die aktive Paarung zeigt Name, Passwort und das eröffnende Team.', '[data-draw-tournament]'),
      s('notify', 'Teilnehmer informieren', 'Nach dem Erstellen erhalten Teilnehmer ihre Teamzuordnung als persönliche Mitteilung. Der Link führt zur eigenen Teamkarte und zur Teamnamenänderung.', '[data-draw-tournament]'),
    ]),
  ]),
  tournaments: t('Turnier', [c('play', 'Mitspielen und Ergebnisse', [
    s('team', 'Dein Team finden', 'Dein Team ist in Paarungen und Tabellen markiert und steht in der Teamübersicht vorn. Während das Turnier läuft, können Teammitglieder den Namen ändern.', '.tournament-teams-section, [data-tournament-teams]'),
    s('lobbies', 'Spielbereite Paarungen', 'Aktive Lobbys zeigt spielbare Begegnungen mit Host-Team und Zugangsdaten. Liga und Gruppen zeigen zunächst die früheste noch offene Runde.', '#tournament-lobbies-title'),
    s('result', 'Ergebnis erfassen', 'Das Plus öffnet die Ergebniseingabe. Speichere einen Sieger oder den konfigurierten Punktestand; K.O.-Matches brauchen einen eindeutigen Sieger.', '[data-open-result]'),
    s('effects', 'Was das Ergebnis auslöst', 'Das Ergebnis aktualisiert Tabelle und Spielplan und zählt auch für die reguläre Rangliste. Neu spielbereite Teilnehmer erhalten die nächste Paarung als Mitteilung.', '.tournament-bracket, .tournament-standings'),
    s('correction', 'Früheres Ergebnis ändern', 'Ein geänderter Sieger kann spätere K.O.-Paarungen und deren Ergebnisse zurücksetzen. Die Bestätigung erklärt die Folgen, bevor die Korrektur gespeichert wird.', '[data-open-result]'),
    s('complete', 'Automatisch abschließen', 'Das letzte erforderliche Ergebnis beendet das Turnier. Ein aktiviertes Spiel um Platz 3 gehört dazu; danach steht der Champion fest.', '.tournament-bracket, .tournament-standings'),
    s('early', 'Vorzeitig beenden', 'Admins können offene Turniere vorzeitig beenden. Erfasste Ergebnisse bleiben erhalten, aber es gibt keinen Turniersieger.', '#tourn-finish', { adminOnly: true }),
    s('delete', 'Turnier löschen', 'Löschen entfernt das Turnier. Bereits erfasste Ranglistenergebnisse bleiben bestehen; die Bestätigung weist darauf hin.', '[data-delete-tournament]', { adminOnly: true }),
  ])]),
  foodOrders: t('Essen', [
    c('order', 'Mitbestellen', [
      s('open', 'Offene Bestellung finden', 'Öffne die passende Sammelbestellung. Abgeschickte und geschlossene Bestellungen liegen in der Historie.', '#food-open-title'),
      s('item', 'Deine Position hinzufügen', 'Trage Gericht, Menge und bei Bedarf den Einzelpreis ein. Fehlende Preise werden genannt und verhindern einen vollständigen Zahlungsbetrag.', '[data-add-item-form]'),
      s('sum', 'Deinen Anteil prüfen', 'Deine Gruppe sammelt Positionen und Gesamtbetrag. Hinterlegtes Trinkgeld ist bereits in der persönlichen Summe berücksichtigt.', '[data-group-toggle]'),
      s('freeze', 'Nach dem Abschicken', 'Abschicken friert die Positionen ein. Änderungen sind erst nach erneutem Öffnen möglich; deine offene Zahlung erscheint auf Home.', '[data-close-order]'),
    ]),
    c('pay', 'Bezahlen', [
      s('person', 'Eine Zahlung pro Person', 'Bezahlt gilt für alle Positionen einer Person. Angemeldete Mitglieder können die Markierung setzen oder korrigieren, solange die Bestellung nicht geschlossen ist.', '[data-toggle-group-paid]'),
      s('paypal', 'PayPal öffnen', 'PayPal übergibt den hinterlegten Empfänger. Bei einem einfachen PayPal.me-Link wird die vollständige Summe ergänzt; unvollständige Preise verhindern die Übergabe.', '[data-group-pay]'),
      s('confirm', 'Bezahlt bestätigen', 'Antworte erst nach deiner Zahlung auf Bezahlt?. Das Öffnen der PayPal-Seite allein markiert noch keine Position als bezahlt.', '[data-group-pay]'),
      s('remind', 'Zahlungserinnerungen', 'Unbezahlte Positionen werden frühestens zwei Stunden nach Abschicken erinnert. Pro Person und Event werden Erinnerungen höchstens alle zwei Stunden erneut fällig.', '[data-toggle-group-paid]'),
      s('close', 'Geschlossene Bestellung', 'Nach Schließen sind Zahlungsmarkierungen und Metadaten gesperrt. Der Ersteller oder ein Admin kann den letzten Sperrschritt wieder zurücknehmen.', '[data-finalize-order]'),
    ]),
    c('organise', 'Bestellung organisieren', [
      s('create', 'Bestellung öffnen', 'Lege Titel, Speisekarte, Hinweise, PayPal und geplanten Versand fest. Das Anlegen informiert die berechtigten Teilnehmer.', '#order-new-btn'),
      s('list', 'Bestellübersicht nutzen', 'Bestellübersicht fasst gleiche Gerichte nach Preis zusammen. Die Liste hilft bei der tatsächlichen Bestellung und zeigt keine persönlichen Zahlungsstände.', '[data-open-order-list]'),
      s('send', 'Selbst beim Lieferdienst bestellen', 'Abschicken sperrt hier die Liste. Es sendet keine Bestellung an den Lieferdienst; bestelle anschließend selbst mit der Bestellübersicht.', '[data-close-order]'),
      s('finalise', 'Abrechnung abschließen', 'Schließen sperrt zusätzlich Zahlungen und Bestellinformationen. Prüfe vorher die offenen Beträge und fehlenden Preise.', '[data-finalize-order]'),
      s('reopen', 'Schrittweise wieder öffnen', 'Wieder öffnen führt von Geschlossen zu Abgeschickt und dann zu Offen. Erst im offenen Zustand lassen sich Positionen wieder ändern oder ergänzen.', '[data-reopen-order]'),
    ]),
  ]),
  profile: t('Mein Profil', [
    c('account', 'Profil und Einstellungen', [
      s('identity', 'Dein Profil bearbeiten', 'Ändere Gamertag, Namen, Bild und Farbe. Speichern übernimmt deinen Entwurf; das Profil erscheint anschließend mit diesen Angaben in der App.', '#profile-name'),
      s('layout', 'Deine Ansicht wählen', 'Automatisch richtet sich nach der Fensterbreite. Desktop und Laptop wählen deine bevorzugte Navigation auf breiten Bildschirmen; auf schmalen Geräten bleibt die kompakte Ansicht.', '#profile-layout'),
      s('push', 'Push aktivieren', 'Aktiviere Push und erlaube Mitteilungen im Browser. Die Berechtigung gehört zu diesem Gerät; deine Mitteilungen findest du zusätzlich im Benachrichtigungszentrum.', '#push-toggle, #profile-push'),
      s('ticker', 'Im Newsticker erscheinen', 'Newsticker erlaubt deinen Namen in erfundenen Meldungen auf dem gemeinsamen Bildschirm. Deaktivieren entfernt betroffene Zeilen mit der nächsten Aktualisierung.', '#profile-newsticker'),
      s('monitors', 'Sichtbare Monitore angeben', 'Wähle Personen, deren Monitore du sehen kannst. Diese Angaben helfen bei der Teamverteilung, wenn Sitznachbarn berücksichtigt werden.', '#profile-monitors-edit', { feature: 'seating' }),
      s('admin', 'Admin-Modus', 'Admin-Modus zeigt Testdaten und zusätzliche Testaktionen. Er verleiht keine Rechte; deine tatsächliche Kontorolle bestimmt die Verwaltungsfunktionen.', '#profile-admin-mode', { adminOnly: true }),
    ]),
    c('agent', 'Agent und Live-Status', [
      s('purpose', 'Spiele erkennen', 'Der Agent erkennt hinterlegte Spiele auf deinem PC und meldet Live-Status und Spielzeit an Respawn. Die Prozesszuordnungen kommen zentral vom Server.', '#profile-agent-title'),
      s('download', 'Persönliches Paket', 'Lade dein Agent-Paket herunter und führe die Installation aus. Es enthält bereits Serveradresse und deinen persönlichen Key; teile es deshalb nicht mit anderen.', '#agent-download'),
      s('extended', 'Erweitertes Tracking', 'Die Downloadoption ergänzt Aktivitätsdaten wie aktives Fenster und Leerlaufzeit. Mehr erfahren erklärt die erfassten Daten und ihre Verwendung.', '#agent-track-activity'),
      s('context', 'Wann erfasst wird', 'Erfassung setzt passende Eventeinstellungen, bestätigte Teilnahme und eine gültige Einwilligung voraus. Die Aktivität gehört zu deinem ausgewählten zulässigen Arbeitsbereich.', '#profile-agent-title'),
      s('pause', 'Erfassung pausieren', 'Pausieren stoppt das Melden des Agenten. Die persönliche Pause auf Home ist eine andere Einstellung und dient deinem sichtbaren Mitspielerstatus.', '#tracking-paused'),
      s('key', 'Key erneuern', 'Key erneuern ersetzt den bisherigen Zugang. Bestehende Agent-Installationen benötigen danach den neuen Key beziehungsweise ein neues persönliches Paket.', '#profile-rotate-key'),
    ], { feature: 'tracking' }),
    c('privacy', 'Einwilligungen und Daten', [
      s('consent', 'Pro Event entscheiden', 'Datenschutz zeigt deine Einwilligungen. Widerrufen beendet weitere Erfassung in diesem Kontext und entfernt den dazugehörigen Live-Stand.', '[data-profile-section="privacy"]', { feature: 'tracking' }),
      s('default', 'Künftige Events vorab erlauben', 'Die Vorab-Erlaubnis gilt für künftig passende Events und ihre aktuelle Einwilligungsversion. Eine ausdrückliche Einzelentscheidung wird dadurch nicht überschrieben.', '[data-profile-section="privacy"]', { feature: 'tracking' }),
      s('delete-tracking', 'Erfasste Spielzeit löschen', 'Daten löschen entfernt deine Spielzeit dieses Events auch aus Statistiken. Deine Einwilligung bleibt bestehen; bei aktivem Tracking können wieder neue Daten entstehen.', '[data-profile-section="privacy"]', { feature: 'tracking' }),
      s('export', 'Persönliche Daten exportieren', 'Meine Daten bietet deinen persönlichen JSON-Export. Er enthält keine geheimen Zugangsdaten.', '[data-profile-section="data"]'),
      s('delete-account', 'Konto löschen', 'Die Löschung verlangt eine erneute Anmeldung. Offene organisatorische Verantwortung oder geschützte Rollen musst du gegebenenfalls vorher übertragen.', '[data-profile-section="data"]'),
    ]),
  ]),
  broadcast: t('Durchsage', [c('broadcast', 'Nachrichten an das Event', [
    s('message', 'Durchsage schreiben', 'Schreibe die Nachricht und lege Sichtbar bis fest. Der aktive Arbeitsbereich bestimmt den berechtigten Empfängerkreis.', '#broadcast-form'),
    s('send', 'Was Senden auslöst', 'Die Nachricht erscheint in der App, gegebenenfalls als Push und auf dem gemeinsamen Bildschirm. Der Absender bleibt erkennbar.', '#broadcast-form'),
    s('current', 'Aktuelle Durchsagen', 'Aktuell zeigt noch gültige Durchsagen. Öffne eine Zeile für den vollständigen Text, Absender und Zeitangaben.', '[data-broadcast-id], .broadcast-table'),
    s('end', 'Beenden oder ablaufen lassen', 'Du kannst deine laufende Durchsage vorzeitig beenden. Nach Ende oder Ablauf liegt sie in der Historie und zählt nicht mehr als aktive Mitteilung.', '[data-end-broadcast]'),
  ])]),
  music: t('Jam', [
    c('listen', 'Musik gemeinsam steuern', [
      s('now', 'Gemeinsame Musikausgabe', 'Jetzt läuft zeigt Titel, Anfragenden und Fortschritt. Die Wiedergabe erfolgt auf dem ausgewählten Musikgerät, nicht automatisch auf deinem eigenen Gerät.', '#music-now-title'),
      s('add', 'Titel hinzufügen', 'Suche nach Titeln und füge Wünsche der gemeinsamen Warteschlange hinzu. Als Nächstes zeigt die bevorstehende Wiedergabe.', '#music-search-form'),
      s('queue', 'Warteschlange bearbeiten', 'Im normalen Anfragebetrieb können Mitglieder Wünsche verschieben oder entfernen. Die Reihenfolge wird auch an die Wiedergabe übergeben.', '#music-queue-title'),
      s('playlist', 'Playlist starten', 'Eine Playlist ersetzt den bisherigen Wiedergabekontext und ausstehende Wünsche nach Bestätigung. Weitere Titel folgen dann den Möglichkeiten der Spotify-Warteschlange.', '#music-search-form'),
      s('controls', 'Gemeinsam steuern', 'Mitglieder können pausieren, fortsetzen und überspringen. Eine aktive Jam beenden dürfen der Host und berechtigte Admins.', '#music-toggle-playback'),
    ]),
    c('setup', 'Musikgerät einrichten', [
      s('controller', 'Controller installieren', 'Starte das Paket auf dem Musik-PC oder Raspberry Pi. Der Controller ist das Wiedergabegerät und erscheint nicht als Spieler.', '#music-setup-title'),
      s('pair', 'Mit Respawn koppeln', 'Ein Kopplungscode verbindet den Controller mit Respawn. Er ist zehn Minuten gültig; eine neue Kopplung ersetzt den bisherigen Controller.', '#music-reconnect-controller'),
      s('spotify', 'Spotify verbinden', 'Die Spotify-Anmeldung bleibt lokal auf dem Musikgerät. Respawn-Verbindung und Spotify-Anmeldung sind getrennte Zustände.', '#music-setup-title'),
      s('device', 'Ausgabe auswählen', 'Wähle beim Start ein Spotify-Gerät. Eine reine Bluetooth-Soundbar ist eine Audioausgabe und kein eigenständiges Spotify-Gerät.', '#music-device-area'),
      s('recover', 'Verbindung wiederherstellen', 'Bei Fehlern erneuere die betroffene Verbindung. Eine abgelaufene Spotify-Anmeldung erfordert keine neue Controller-Installation; ein neues Respawn-Pairing verwendet einen frischen Code.', '#music-setup-title, #music-recovery-title'),
    ], { adminOnly: true }),
  ]),
  myStats: t('Meine Statistiken', [c('personal', 'Eigene Auswertung', [
    s('filter', 'Event auswählen', 'Der Filter begrenzt die Auswertung. Alle Events fasst die für dich zugängliche Datenbasis zusammen.', '.search-select'),
    s('time', 'Spielzeit und Aktivität', 'Spielzeit, aktiver Anteil, Sessions und parallele Zeiten beschreiben unterschiedliche Aspekte. Eine laufende Erfassung und passende Einwilligungen bestimmen die Datenbasis.', '.my-stats-kpis'),
    s('details', 'Details aufklappen', 'Erfolge, Spielzeit pro Spiel und Event sowie längste Sessions zeigen weitere Einzelheiten. Öffne die passende Karte.', '.collapsible-section'),
    s('deletion', 'Gelöschte Daten fehlen hier', 'Löschst du eigene Event-Spielzeit im Profil, verschwindet sie auch aus diesen Auswertungen. Neue zulässige Erfassung kann anschließend wieder Werte ergänzen.', '.collapsible-section'),
  ])]),
  leaderboard: t('Rangliste', [c('ranking', 'Ergebnisse und Punkte', [
    s('sources', 'Woher Ergebnisse kommen', 'Ranglistenwerte entstehen aus erfassten Matches und Turnierergebnissen. Reine Spielzeit gehört in die Statistiken.', '.ranked-list'),
    s('filter', 'Nach Spiel filtern', 'Alle Spiele zeigt die gemeinsame Rangliste. Der Spielfilter grenzt sie auf Ergebnisse dieses Spiels ein.', '.search-select'),
    s('record', 'Freies Ergebnis erfassen', 'Ergebnis eintragen erlaubt ein Match mit Spiel, Teilnehmern, Teams oder Frei-für-alle. Speichern übernimmt das Ergebnis in die Wertung.', '[id="add-match-btn"]'),
    s('correction', 'Ergebnisse korrigieren', 'Bearbeiten aktualisiert den vorhandenen Eintrag. Löschst du ein gewertetes Einzelmatch, entfällt sein Beitrag zur Rangliste.', '.ranked-list'),
  ])], { adminOnly: true }),
  analytics: t('Statistiken', [c('analytics', 'Gemeinsame Auswertung', [
    s('event', 'Datenbasis wählen', 'Wähle ein Event oder Alle Events. Spielzeit, Matches und Turniere folgen dieser Auswahl.', '.search-select'),
    s('metrics', 'Kennzahlen unterscheiden', 'Spielzeit, Sessions, Matches, Turniere, Auslosungen und Arcade-Partien zählen unterschiedliche Vorgänge. Öffne die jeweilige Detailkarte für die Einträge.', '.collapsible-section'),
    s('arcade', 'Arcade im Zeitraum', 'Arcade-Ergebnisse haben keine direkte Eventzuordnung. Die Eventauswertung berücksichtigt deshalb dessen Zeitgrenzen.', '.collapsible-section'),
    s('history', 'Protokoll und Rekorde', 'Session-Protokoll, Awards und Trivia leiten sich aus vorhandenen Daten ab. Gelöschte oder korrigierte Quelldaten verändern die zugehörige Auswertung.', '.collapsible-section'),
  ])], { adminOnly: true }),
  hallOfFame: t('Hall of Fame', [c('champions', 'Vergangene Erfolge', [
    s('alltime', 'Siege über mehrere Events', 'Gesamtsiege und Turniersiege zeigen unterschiedliche Erfolge. Gleiche Werte können denselben Rang teilen.', '.collapsible-section'),
    s('event', 'Ein Event ansehen', 'Nach Event zeigt dessen Platzierungen und Turnierchampions. Der Filter bezieht sich auf historische Ergebnisse.', '.search-select'),
    s('unfinished', 'Kein Champion ohne Abschluss', 'Vorzeitig beendete Turniere behalten ihre gespielten Ergebnisse, krönen aber keinen Champion. Sie erzeugen deshalb keinen Turniersieg.', '.collapsible-section'),
  ])], { adminOnly: true }),
  seating: t('Sitzplan', [c('seats', 'Plätze verwalten', [
    s('plan', 'Gemeinsamer Tischplan', 'Belegte und freie Plätze bilden den Tisch ab. Der Plan erscheint auch als lesende Ansicht auf Home.', '.seating-layout, .seating-plan'),
    s('assign', 'Platz zuweisen', 'Tippe einen Sitz an und wähle eine Person. Sitzt sie bereits anderswo, werden die beiden Plätze getauscht. Desktop bietet zusätzlich Drag-and-drop.', '.seating-seat'),
    s('resize', 'Tisch ändern', 'Lege die Platzanzahl je Seite fest. Fallen belegte Plätze weg, landen deren Personen unter Ohne Platz.', '#seating-table-edit'),
    s('neighbors', 'Nachbarn und Teams', 'Nachbarn am Tisch gelten als sichtbare Monitore. Diese Beziehungen können bei einer Team-Auslosung berücksichtigt werden.', '.seating-seat'),
  ])], { adminOnly: true }),
  kiosk: t('Broadcast', [c('screen', 'TV-Kiosk öffnen', [
    s('event', 'Event auswählen', 'Die Verwaltung bietet verfügbare veröffentlichte LAN-Events. Broadcast öffnen startet einen eigenen lesenden Bildschirm für das gewählte Event.', '.kiosk-open-link'),
    s('login', 'Eigenes Bildschirmkonto', 'Jedes Event besitzt ein eigenes Kiosk-Konto. Das gemeinsame Passwort ist hier kopierbar; dieses Konto wird nie zu einem Spielerprofil.', '.kiosk-open-link'),
    s('scope', 'Jeder Bildschirm bleibt zugeordnet', 'Ein geöffneter Broadcast behält seine Eventbindung. Ein späterer Aufruf für ein anderes Event verändert bereits geöffnete Bildschirm-Tabs nicht.', '.kiosk-open-link'),
    s('cards', 'Was auf dem Bildschirm steht', 'Live-Status, Newsticker, Vote und Turnier bilden das Dashboard. Gemeinsame Mitteilungen erscheinen als Banner; Jam ergänzt die Musikleiste.', '.kiosk-open-link'),
    s('vote', 'Vote-Ergebnis enthüllen', 'Während einer Abstimmung bleiben die Spiele maskiert. Nach dem Ende folgen Countdown und Ergebnisanzeige, damit der Bildschirm die laufende Wahl nicht beeinflusst.', '.kiosk-open-link'),
    s('ticker', 'Erfundene Meldungen', 'Newsticker kombiniert spielerische Schlagzeilen mit Eventbezug. Im Profil kann jede Person den eigenen Namen dafür deaktivieren.', '.kiosk-open-link'),
  ])], { adminOnly: true }),
  admin: t('Admin', [
    c('tools', 'Werkzeuge und Bereitschaft', [
      s('tools', 'Verwaltungswerkzeuge', 'Hier öffnest du Auswertung, Feedback, Nutzungsauswertung, Sitzplan und TV-Kiosk. Sichtbarkeit und Aktionen richten sich nach Rolle und Eventfunktionen.', '[data-navigate="leaderboard"]'),
      s('ready', 'LAN-Bereitschaft prüfen', 'Die Bereitschaft prüft Server, Event, Teilnehmer, Agenten, Prozesszuordnungen, Kiosk und Backup. Details und Diagnose erklären auffällige Prüfungen.', '#admin-readiness-title', { feature: 'tracking' }),
      s('backup', 'Backup herunterladen', 'Ein Backup erstellt einen geprüften Datenbanksnapshot. Die geschützte Aktion kann erneut nach deinem Passwort fragen.', '#download-backup'),
    ]),
    c('accounts', 'Einladungen und Konten', [
      s('invite', 'Einladungslink erstellen', 'Link erstellen bietet eine teilbare Einladung und einen QR-Code. Prüfe Gültigkeit und Eventzuordnung, bevor du den Link weitergibst.', '#admin-register-link'),
      s('revoke', 'Einladung widerrufen', 'Widerrufen sperrt einen noch verwendbaren Link. Es löscht keine bereits bestehenden Konten.', '#admin-invites-title'),
      s('roles', 'Konten verwalten', 'Owner, Admins und Mitglieder haben unterschiedliche Rechte. Rollen ändern, Claim- oder Reset-Link und Deaktivieren sind getrennte Aktionen.', '#admin-players-title'),
      s('mode', 'Rolle und Admin-Modus', 'Die Rolle bestimmt die Berechtigung. Der lokale Admin-Modus im Profil blendet Testdaten und Testaktionen ein; er verleiht keine zusätzlichen Rechte.', '#admin-players-title'),
      s('test', 'Testdaten bereinigen', 'Testdaten erscheinen im Admin-Modus. Aufräumen entfernt markierte Testspieler und Testevents nach Bestätigung; prüfe den Umfang vorher.', '#admin-test-players-title'),
    ]),
  ], { adminOnly: true }),
  adminFeatureUsage: t('Nutzungsauswertung', [c('usage', 'Nutzungsdaten lesen', [
    s('basis', 'Datenbasis prüfen', 'Die Übersicht zeigt die ausgewerteten Personen und vorhandene Nutzung je Funktion. Prüfe den Eventfilter, bevor du Anteile vergleichst.', '.search-select'),
    s('scope', 'Nicht jeder Wert ist eventbezogen', 'Funktionen ohne Eventzuordnung bleiben auch bei gesetztem Filter eventübergreifend. Solche Zeilen sind mit alle Events gekennzeichnet.', '.ranked-list'),
    s('refresh', 'Aktuellen Stand laden', 'Aktualisieren lädt die Auswertung erneut. Die Zahlen beschreiben gespeicherte Nutzung und sind keine vollständige Aufzeichnung jeder Bildschirmaktion.', '#admin-feature-usage-refresh'),
  ])], { adminOnly: true }),
  adminFeedback: t('Feedback', [c('inbox', 'Rückmeldungen bearbeiten', [
    s('context', 'Kontext mitlesen', 'Feedback enthält Nachricht, Absender, Art, ursprüngliche Ansicht, Event und Gerätegrößenklasse. Öffne die Zeile für den vollständigen Kontext.', '[data-feedback-entry]'),
    s('find', 'Suchen und filtern', 'Suche berücksichtigt die vollständige Nachricht. Sortierung und Artfilter helfen beim Bearbeiten offener Rückmeldungen.', '#admin-feedback-search'),
    s('resolve', 'Erledigen und wieder öffnen', 'Erledigt verschiebt die Meldung in die Historie. Wieder öffnen macht sie erneut bearbeitbar und erhält Nachricht und Kontext.', '[data-feedback-entry]'),
    s('refresh', 'Neue Meldungen laden', 'Aktualisieren lädt neue Rückmeldungen. Diese Übersicht erhält keine automatische Echtzeit-Aktualisierung.', '#admin-feedback-refresh'),
  ])], { adminOnly: true }),
  more: t('Mehr', [c('navigation', 'Weitere Bereiche', [
    s('workspaces', 'Events und Gruppen', 'Events & Gruppen verwaltet die Arbeitsbereiche. Der Eventname oben wechselt anschließend zwischen den für dich verfügbaren Bereichen.', '[data-navigate="events"]'),
    s('profile', 'Persönliche Einstellungen', 'Mein Profil enthält Identität, Ansicht, Push und persönliche Daten. Deine eigene Live-Status-Karte führt ebenfalls dorthin.', '[data-navigate="profile"]'),
    s('orga', 'Gemeinsam vorbereiten', 'Orga bündelt die Planung passend zum Eventtyp. Allgemeine Events bieten diese Bereiche direkt in der Hauptnavigation.', '[data-navigate="eventPolls"], [data-section="orga"]'),
    s('tour', 'Hilfe im jeweiligen Bereich', 'Das Fragezeichen am Bereichstitel öffnet die passenden Touren. Du kannst Kapitel einzeln starten und später an derselben Stelle fortsetzen.'),
  ])]),
  info: t('Info', [c('reference', 'Informationen nachschlagen', [
    s('entries', 'Alles Wichtige nachschlagen', 'Info öffnet WLAN, Links, Serveradressen und Hinweise über deiner aktuellen Ansicht. Du verlierst dadurch deinen bisherigen Arbeitsbereich nicht.', '[data-open-entry]'),
    s('copy', 'Öffnen oder kopieren', 'Die Zeile öffnet den vollständigen Inhalt mit Links. Das Kopiersymbol übernimmt den Inhalt direkt in die Zwischenablage.', '[data-copy-entry]'),
    s('manage', 'Informationen pflegen', 'Berechtigte Admins erstellen, bearbeiten und löschen Einträge. Änderungen aktualisieren die geöffnete Übersicht.', '#info-new-btn', { adminOnly: true }),
  ])]),
  feedback: t('Feedback', [c('send', 'Rückmeldung senden', [
    s('kind', 'Art auswählen', 'Positiv, Negativ, Problem oder Idee helfen bei der Einordnung. Schreibe anschließend kurz, was dir aufgefallen ist.', '#feedback-sentiment-toggle'),
    s('context', 'Die Herkunft kommt mit', 'Respawn ergänzt die beim Öffnen aktive Ansicht, das Event und eine Gerätegrößenklasse. So kann die Rückmeldung dem richtigen Bereich zugeordnet werden.', '#feedback-message'),
    s('submit', 'Bewusst senden', 'Senden übermittelt deine Nachricht an die Admins. Das Öffnen der Hilfe und dieser Tour versendet noch kein Feedback.', '#feedback-form'),
  ])]),
};

export function tourItemAvailable(item, { admin = false, event = null } = {}) {
  return !(item.adminOnly && !admin)
    && (!item.feature || !Array.isArray(event?.enabledFeatures) || event.enabledFeatures.includes(item.feature));
}

export function availableTour(tour, context = {}) {
  if (!tour || !tourItemAvailable(tour, context)) return null;
  const chapters = tour.chapters.filter((chapter) => tourItemAvailable(chapter, context))
    .map((chapter) => ({ ...chapter, steps: chapter.steps.filter((step) => tourItemAvailable(step, context)) }))
    .filter((chapter) => chapter.steps.length > 0);
  return chapters.length ? { ...tour, chapters } : null;
}

export function getAreaTour(key, context = {}) {
  return availableTour(AREA_TOURS[key], context);
}
