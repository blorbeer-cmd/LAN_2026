# Respawn in ChatGPT

Respawn stellt einen MCP-Server im normalen Node-Prozess unter `/mcp` bereit. Er wird mit dem
üblichen Server-Image gebaut und ausgeliefert. Es gibt keinen zweiten Container, Port oder
OpenAI-Modellschlüssel für diese Anbindung. ChatGPT benötigt Internetzugang zum öffentlichen
HTTPS-Endpunkt; der normale Respawn-Betrieb bleibt davon unabhängig.

## Server aktivieren

In der nicht versionierten `.env` der Serverinstallation setzen:

```dotenv
MCP_ENABLED=1
PUBLIC_BASE_URL=https://deine-respawn-domain.example
```

Die Domain durch den tatsächlichen öffentlichen HTTPS-Ursprung ersetzen, ohne Unterpfad, Query
oder Fragment. `PUBLIC_BASE_URL` wird bereits für die Agent-Downloads verwendet und muss dieselbe
öffentliche Serveradresse bezeichnen. Keine Tokens oder Passwörter in diese URL schreiben.

Im vorhandenen Produktionsverzeichnis die geänderte Umgebung übernehmen:

```sh
docker compose up -d --wait app
```

Dieser Befehl aktiviert die Konfiguration eines bereits ausgelieferten Images; er ersetzt nicht
den regulären Build-/Deploy-Ablauf. Das Cloudflare-Tunnel-Setup leitet dieselbe Domain bereits
an die App weiter. Es muss `/mcp` einschließlich POST und die OAuth-Metadaten durchlassen;
eine vorgeschaltete interaktive Cloudflare-Access-Anmeldung darf diese Serveraufrufe nicht
blockieren. Die MCP-Endpunkte selbst verlangen die persönliche OAuth-Freigabe.

Ohne `MCP_ENABLED=1` bleibt der externe MCP-Zugang geschlossen. Die manuelle Admin-Bereinigung
ist unabhängig davon unter `/admin/draw-cleanup` verfügbar. Eine ungültige `PUBLIC_BASE_URL` wird
in der Verbindungsverwaltung als Konfigurationsfehler angezeigt; das übrige LAN-Tool bleibt erreichbar.

Prüfen:

```sh
curl -i https://deine-respawn-domain.example/.well-known/oauth-protected-resource/mcp
curl -i https://deine-respawn-domain.example/.well-known/oauth-authorization-server
```

Die Metadaten müssen den tatsächlichen HTTPS-Ursprung und die Ressource mit `/mcp` nennen.
Ein POST auf `/mcp` ohne gültigen Bearer-Token liefert `401` mit einem `WWW-Authenticate`-Hinweis.
Ein GET auf `/mcp` liefert `405`: verwendet wird zustandsloses Streamable HTTP über POST, kein
dauerhafter SSE-Abonnementkanal. `/api/health` bleibt unabhängig von ChatGPT.

## In ChatGPT verbinden

Die konkrete Verfügbarkeit hängt vom ChatGPT-Konto und den Workspace-Rechten ab. Im aktuellen
Web-Client ist der Ablauf:

1. **Plugins → Plus → Add custom MCP server** öffnen.
2. Als Namen beispielsweise **Respawn** und als Server-URL
   `https://deine-respawn-domain.example/mcp` eintragen.
3. **OAuth** wählen. Keine statische Client-ID und kein Client-Secret eintragen: Respawn
   unterstützt Dynamic Client Registration und PKCE mit `S256`.
4. Den angezeigten Verbindungshinweis prüfen und das Plugin erstellen beziehungsweise installieren.
5. Im Respawn-Anmeldefenster persönlich anmelden, ein zugängliches Event auswählen und den
   Datenzugriff freigeben. Die optionale Admin-Bereinigung bleibt ohne ausdrückliche Freigabe aus.
6. Im Chat über **@ → Respawn** auswählen und eine Frage stellen.

ChatGPT kann die OAuth-Anmeldung bereits beim Erstellen oder beim ersten Werkzeugaufruf öffnen.
Falls das Konto keinen eigenen MCP-Anschluss erlaubt, müssen zunächst die entsprechenden
Workspace-/Kontorechte verfügbar sein. Die reine Existenz des Server-Endpunkts schaltet diese
ChatGPT-Funktion nicht frei.

Die aktuellen Schritte und mögliche Änderungen stehen in der
[OpenAI-Anleitung für eigene MCP-Server](https://developers.openai.com/api/docs/guides/custom-mcp-server).
Die Implementierung unterstützt die dort beschriebenen ChatGPT-Callbacks, einschließlich des
stabilen Callbacks mit OAuth-Issuer-Prüfung und des Callback-ID-spezifischen Pfads. Andere
OAuth-Clients und frei wählbare Rücksprungadressen werden im privaten Pilot nicht registriert.

## Beispiele

- „Mit welchem Event bin ich verbunden? Zeig die Teilnehmer.“
- „Welche Spiele wurden nach erfassten Spielerstunden am meisten gespielt?“
- „Wie viele automatische Auslosungen, Drafts und Rematches gab es? Wie viele ohne Ergebnis?“
- „Wie viele Umfragen gab es und wie viele eindeutige Personen haben geantwortet?“
- „Wie viele Antwortteilnahmen waren das insgesamt? Berücksichtige auch Umfragen ohne Antworten.“
- „Wie viele Matches und Turniere haben wir eingetragen?“
- „Schlage für diese vier Teilnehmer zwei ausgeglichene Teams vor.“
- „Schreib einen Rückblick mit den veröffentlichten Ergebnissen.“
- Als entsprechend freigegebener Admin: „Bereite eine Bereinigung automatischer Auslosungen
  ohne Ergebnis vor, die älter als sieben Tage sind.“

Die Daten sind strikt auf das freigegebene Event beschränkt. Für ein anderes Event eine neue
Verbindung anlegen und das gewünschte Event auswählen; der aktive Browser-Workspace bleibt dabei
unverändert. Eventübergreifende Vergleiche sind in dieser Version nicht enthalten.

## Werkzeuge und Definitionen

Reguläre Werkzeuge: `get_context`, `get_overview`, `get_game_options`, `get_competitions`,
`get_statistics`, `get_event_summary`, `preview_teams`.

`get_statistics` unterstützt `playtime_by_game`, `players_by_game`, `team_formations`,
`draws_without_result`, `recorded_matches`, `tournament_counts`, `poll_usage`, `poll_participation`
und das zusätzliche Admin-Werkzeug innerhalb derselben Abfrage `feature_usage`.
Die Schemata der Werkzeuge enthalten die verfügbaren Filter. Nicht unterstützte Filter oder
zusätzliche Event-IDs werden abgewiesen. Zeitfilter verwenden UTC-Millisekunden im halboffenen
Intervall `[from,to)`. Spielzeit wird auf das Intervall zugeschnitten; Matches werden nach
`played_at`, Turniere nach Anlagezeit und Umfragen nach Start-/Anlagezeit gefiltert. Die
Umfrageantworten zeigen den aktuellen gespeicherten Stand dieser ausgewählten Runden, keinen
historischen Stand zum Zeitpunkt `to`.

„Spielerstunden“ summiert erfasste Laufzeit über Personen. Zehn Personen mit je zwei Stunden
ergeben zwanzig Spielerstunden. Das ist weder Veranstaltungsdauer noch gemessene aktive Spielzeit.
Eine Session ist kein Match. Gleichzeitige Spiele können Summen zusätzlich erhöhen.

Teamaufstellungen werden nach automatischer Auslosung, Captain-Draft und Rematch getrennt.
Ohne Ergebnis bedeutet ausschließlich fehlende Ergebnisverknüpfung. Ein eingetragenes Remis oder
ein Ergebnis ohne Sieger ist weiterhin ein Ergebnis. Daten ohne Ergebniseintrag können trotzdem
gespielt worden sein. Zählungen erfolgen vollständig vor einer Top-N-Begrenzung der Antwort.

Umfragen zählen eindeutige Personen je Runde, Antwortteilnahmen über Runden und eindeutige
Personen insgesamt getrennt. Geänderte Antworten und mehrere bewertete Optionen erhöhen die
Personenzahl nicht. Verborgene Beteiligungswerte bleiben unbekannt; Gesamtsummen werden dann
als unvollständig kenntlich gemacht. Ohne unveränderlichen historischen Teilnehmerkreis wird
keine Beteiligungsquote behauptet. Klicks, Seitenaufrufe und Verweildauer werden nicht erfasst.
Die ergänzende Nutzungsauswertung enthält nur eventgebundene Kennzahlen; gruppenweite Werte
werden durch eine einzelne Event-Freigabe nicht zugänglich.

## Admin-Bereinigung

Über **Admin → Auslosungen aufräumen** oder direkt `/admin/draw-cleanup` erreichbar. Die Seite
enthält ausschließlich die Bereinigung und ist auch ohne ChatGPT oder aktiviertes MCP nutzbar.

1. Ein zugängliches Event und ein positives Alter in ganzen Stunden oder Tagen auswählen.
   Ein Tag entspricht 24 Stunden. Standard sind sieben Tage und automatische Auslosungen.
   Captain-Drafts und Rematches müssen ausdrücklich einbezogen werden.
2. Vorschau erstellen. Sie zeigt einen festen Stichtag, genaue betroffene IDs und geschützte
   Einträge mit Gründen. Vor diesem Zeitpunkt bedeutet strikt `<`; ein Eintrag genau am
   Stichtag wird nicht gelöscht.
3. Die konkrete Auswahl prüfen und dauerhaftes Löschen bestätigen. Falls erforderlich das
   persönliche Passwort in Respawn erneut bestätigen. Die Freigabe gilt wie bei bestehenden
   Admin-Aktionen fünf Minuten, der Löschplan zehn Minuten.

Auslosungen mit Ergebnis sind nicht Bestandteil der Auswahl. Turniergebundene Auslosungen und
alle mit verknüpften Wettrunden oder Abrechnungen bleiben geschützt. Die Ausführung prüft
Identität, Rolle, Event, Freigabe und Kandidaten erneut atomar. Bei zwischenzeitlichen Änderungen
liefert sie `409` und löscht nichts; dann eine neue Vorschau erstellen. Neue Kandidaten werden
nicht nachträglich aufgenommen. Wiederholte Bestätigung desselben Plans liefert dessen Ausgang,
ohne erneut zu löschen. Die Einzel-Löschroute für Match-Historieneinträge wird dafür nicht benutzt.

Die MCP-Werkzeuge `preview_draw_cleanup` und `execute_draw_cleanup` verlangen zusätzlich
`draws:cleanup`. Ein Chat kann einen Bestätigungslink vorbereiten und den Ausgang abrufen;
er kann die persönliche Prüfung und Freigabe in Respawn nicht selbst erzeugen. Konten ohne
aktuelle Admin-/Owner-Rolle dürfen diese Werkzeuge trotz früherer Freigabe nicht verwenden.

Es gibt keine automatische periodische Löschung und kein Undo. Eine Wiederherstellung aus
einem Backup wäre ein eigener Betriebsablauf. Bestandsstatistiken sinken nach Löschungen.
Das Audit protokolliert Akteur, Event, Stichtag, Quellen und Anzahl unter einem Batchbezug.
Vorschauen sind auf 1000 passende Einträge begrenzt; bei Überschreitung wird keine Teilmenge
stillschweigend gelöscht. Dann über Spiel oder höheres Alter eingrenzen. Ein Konto kann höchstens
20 noch gültige Pläne halten. Alte Plandetails werden nach Ablauf plus sieben Tagen entfernt.

## Zugriff widerrufen und Betrieb

**Mein Profil → ChatGPT-Verbindungen → Verwalten** zeigt die eigenen Verbindungen. Widerruf
verhindert weitere Abrufe und die Ausführung verknüpfter Löschpläne. Bereits im Chat angezeigte
Daten werden dadurch nicht aus dem Gespräch entfernt.

Access-Tokens gelten höchstens eine Stunde, Refresh-Tokens rotieren und die Verbindung endet
spätestens 30 Tage nach Freigabe. Der Server speichert ausschließlich Token-Hashes. Aktuelle
Rollen, Kontostatus, Community und angenommene Eventteilnahme werden bei jedem Aufruf geprüft.
Verlust der Teilnahme oder Deaktivierung beendet den Zugriff unmittelbar. Andere Browser-
Sessions und Agent-Keys werden für MCP nicht verwendet.

Verbindungen und bestätigbare Pläne liegen in derselben SQLite-Datei wie Respawn und überstehen
einen normalen Deploy-Neustart. Laufende OAuth-Anfragen und noch nicht eingelöste Codes sind
kurzlebig im Speicher: Bei einem Neustart während der Anmeldung die Verbindung erneut starten.
Die Registrierung vorhandener OAuth-Clients wird bei einem Deploy nicht ersetzt. Zugänge werden
im bestehenden Backup mitgesichert; nach einem Restore die Integrationsfreigaben prüfen und
unerwünschte alte Zugänge widerrufen, bevor der Server wieder öffentlich zugänglich wird.

## Verifikation

Die Integrationssuite `src/test/api.mcp.test.ts` prüft unter anderem OAuth/PKCE, Wiederholungen,
Token-Widerruf, Schema-Validierung, nebenwirkungsfreie Vorschauen, Statistikdefinitionen,
Umfragen ohne Antworten und veränderte/geschützte Löschkandidaten. Migration 141 wird mit
Legacy-Daten, Fehlerrollback und Wiederholung geprüft. Der bestehende Shell-Browser-Owner
prüft die persönliche Verwaltungsseite und die leere Bereinigungsvorschau auf Handy und Laptop.

Eine Verbindung im tatsächlichen ChatGPT-Konto und das produktive HTTPS-Routing müssen nach
dem Deployment separat geprüft werden. Lokale Tests sind kein Nachweis eines Live-Deployments.
