# User-Management – Umsetzungsstatus

Stand: 2026-07-16, verifiziert gegen lokale Remote-Refs und GitHub. Statuswörter sind bewusst getrennt: **implementiert**, **getestet**, **reviewt**, **gemergt**.

## Ziel

Persönliche, dauerhaft angemeldete Konten ersetzen Shared-Identity/Admin-PIN. Darauf entsteht ein Multi-Tenant-Modell: Ein globales Konto kann mehreren privaten Gruppen angehören; Gruppen sind dauerhafte Daten- und Autorisierungsgrenzen, Events zeitlich begrenzte Unterräume. Zusätzliche Gruppen bleiben bis zur vollständigen REST-, Tracking-, Realtime-, Push-, Kiosk- und Arcade-Isolation deaktiviert.

## Verbindliche Architekturentscheidungen

- Konto und bestehender `players`-Datensatz bleiben eine Entität; Authentifizierung: Name + Passwort, 15–200 Zeichen, keine Komplexitäts-/Rotationspflicht, scrypt, langes HTTP-only-Session-Cookie (90 Tage gleitend, 180 Tage absolut), Step-up für kritische Aktionen.
- scrypt-Kosten erst nach Wechsel von `scryptSync` auf asynchrones `crypto.scrypt` und Benchmark erhöhen. HIBP-Prüfung bleibt **offen**.
- Ein Konto darf mehreren privaten Gruppen angehören. Gruppen sind dauerhaft und die primäre Mandanten-/Autorisierungsgrenze; Rollen: `owner`, `admin`, `member`, mindestens ein aktiver Owner.
- Gruppenbeitritt nur per atomarem, ablaufendem, widerrufbarem Einmal-Invite und aktiver Annahme. Events gehören unveränderlich genau einer Gruppe, sind zeitlich begrenzt und erlauben in V1 nur Gruppenmitglieder; Gäste sind späterer Scope.
- Gruppen-Admins verwalten nur Mitglieder, Events und Daten ihrer Gruppe; globale Account-Recovery/API-Keys bleiben außerhalb ihrer Rechte. Fremde Ressourcen liefern `404`, fehlende Gruppenrolle `403`.
- Tracking-Zustimmung ist personenbezogen und gruppenbezogen, für neue Gruppen standardmäßig aus und nicht durch Admins aktivierbar. Dieselbe Aktivität darf mit Zustimmung in mehreren Gruppen zählen; es gibt keine globale Rohdatenablage als Hintertür.
- Zielmodell: Fachdaten tragen `group_id`, optional `event_id`; `event_id = NULL` ist der Gruppenraum. Der alte Sentinel bleibt nur als Migrations-/Kompatibilitätszustand bis zum vollständigen Backfill.
- Keine gruppenübergreifenden Profile, Kataloge, Ranglisten oder Auswertungen. `MULTI_GROUPS_ENABLED=0` bleibt bis einschließlich 5e verbindlich.
- Noch offen: HIBP; wer Gruppen anlegen darf; verpflichtende Event-Annahme; Löschung alter Tracking-Historie bei Widerruf; Sichtbarkeit ehemaliger Mitglieder; gruppenspezifische Namen/Avatare; Überlappung von Events derselben Gruppe; Aufbewahrungsfrist. Siehe [Konzept §16](../KONZEPT-USER-MANAGEMENT.md#16-noch-offene-produktentscheidungen); die Rev.-4-Fassung liegt bis zum Merge nur in #198.

## PR-Stack und Merge-Reihenfolge

1. [#197](https://github.com/blorbeer-cmd/LAN_2026/pull/197) · `claude/user-management-auth-core` → `main` · offen, ready, `CLEAN` · Phasen 1–4 · implementiert/getestet/reviewt, **nicht gemergt**. Head `3b3806f`; aktuelles `main` ist zwei Commits weiter, GitHub meldet dennoch konfliktfrei.
2. [#198](https://github.com/blorbeer-cmd/LAN_2026/pull/198) · `claude/user-management-concept-xbro77` → `claude/user-management-auth-core` · offen, Draft, `CLEAN` · Rev. 4 Multi-Group-Konzept · erstellt/CI-grün, **nicht reviewt/nicht gemergt**. Der Head `d0f0446` ist nicht Nachfahre des finalen #197-Heads: nach #197 mit `main` synchronisieren/retargeten, Diff prüfen, dann vor der Gruppenimplementierung mergen.
3. [#199](https://github.com/blorbeer-cmd/LAN_2026/pull/199) · `codex/group-management` → `claude/user-management-auth-core` · offen, ready (PR-Body sagt veraltet „Draft“), `CLEAN` · Phasen 5a–5b · implementiert/getestet/reviewt, **nicht gemergt**. Nach #197 und vorzugsweise #198 auf `main` retargeten.
4. [#200](https://github.com/blorbeer-cmd/LAN_2026/pull/200) · `claude/group-scoping-catalog-presence` → `codex/group-management` · offen, Draft, `CLEAN` · Phase 5c Cluster 1 · implementiert/getestet, **nicht reviewt/nicht gemergt**. Erst nach #199; danach auf `main` retargeten.
5. [#201](https://github.com/blorbeer-cmd/LAN_2026/pull/201) · `claude/group-scoping-competition` → `claude/group-scoping-catalog-presence` · offen, Draft, `CLEAN` · Phase 5c Cluster 2 · implementiert/getestet, **nicht reviewt/nicht gemergt**. Erst nach #200; danach auf `main` retargeten.

Erforderliche Reihenfolge: **#197 → #198 → #199 → #200 → #201**. Nach jedem Merge Base aktualisieren, nur den verbleibenden fachlichen Diff prüfen und CI erneut abwarten. Historische Konzept-PRs [#116](https://github.com/blorbeer-cmd/LAN_2026/pull/116), [#139](https://github.com/blorbeer-cmd/LAN_2026/pull/139) und [#195](https://github.com/blorbeer-cmd/LAN_2026/pull/195) sowie Test-User-Basis [#123](https://github.com/blorbeer-cmd/LAN_2026/pull/123) sind bereits gemergt; Rev. 4 in #198 ersetzt die frühere Ein-Gruppen-/Sentinel-Planung.

## Abgeschlossene Phasen

- In `main` gemergt: nur Konzeptvorstufen und Test-User/Admin-Basis; keine Implementierungsphase 1–5 ist derzeit gemergt.
- #197 Phasen 1–4: Auth-Schema/-Flows, Required-Mode-Identität für REST/Socket, Rollen/Admin-Härtung, Deaktivierung, Agent-Key-Schutz/-Rotation, Step-up/Audit, Invite/Claim/Reset-UI, Recovery und Required-Mode-Gate sind implementiert und getestet. Produktiv-Cutover ist ein separater Betriebsschritt.
- #199 Phasen 5a–5b: Gruppen/Mitgliedschaften/Rollen/Invites, Startgruppe, zentraler ressourcenbasierter Guard, Gruppen-/Eventverwaltung, Audit-Isolation und Lifecycle-Invarianten sind implementiert und getestet; wegen Feature-Flag noch nicht produktiv freigegeben.
- #200: Spielekatalog, Prozessnamen, Skills/Präferenzen, Live-Status und Play-Sessions sind gruppengescoopt. #201: Matches, Draws, Turniere, Leaderboard/Stats/Analytics/Hall-of-Fame/Export sind gruppengescoopt; ein echter fremder `eventId`-Export-Leak ist im Branch geschlossen.

## Aktuelle Arbeiten

- #197 ist mergebereit laut letztem Owner-Re-Review, braucht aber formale Thread-Triage (siehe unten).
- #198 benötigt Aktualisierung auf den finalen #197-Stand und fachliches Review; die lokale/current-#199-Version von `docs/KONZEPT-USER-MANAGEMENT.md` ist noch Rev. 2 und daher nicht Zielstand.
- #199 ist fachlich für 5a–5b abgeschlossen. Mehrgruppenbetrieb ist ausdrücklich **nicht** fertig/einschaltbar, solange 5c–5e fehlen.
- #200/#201 sind grüne Drafts ohne Review. #200 verwendet beim Agenten vorläufig die Gruppe des einzigen global trackenden Events; das ist Kompatibilitätslogik, nicht das Rev.-4-Ziel des Fan-outs in alle eingewilligten Gruppen aus Phase 5d.

## Noch ausstehende Phasen

1. Phase 5c Cluster 3 „Votes/Drafts“: `votes`, `vote_rounds`, `drafts`, Result-Joins und globale `app_state`-/Singleton-Gates pro Gruppe modellieren; Same-/Cross-Group-Concurrency testen. Abhängig von #201.
2. Phase 5c Cluster 4 „Seating/Pings“: Sitzplan, Sitznachbarn und Pings samt Lesern/Exporten scopen.
3. Phase 5c Cluster 5 „Organisation/Kommunikation“: Bestellungen, Anreisen, Fahrgemeinschaften, Broadcasts, Push-Historie und Info-Board scopen.
4. Phase 5c Cluster 6 „Arcade“: Lobbys, Zuschauer, Quiz-/Matchdaten und Ergebnisse scopen. Schema/REST gehören zu 5c; Room-/Kiosk-/Push-Auslieferung zu 5e.
5. Phase 5d „Tracking & Events“: Agent-Fan-out, historisierte Gruppen-/Event-Consents, paralleles Tracking verschiedener Gruppen, Event-Annahme/Zeitgrenzen, `visibility_scope`, proratisierte Auswertung und idempotentes Session-Schließen.
6. Phase 5e „Realtime & öffentliche Flächen“: bewusste Group/Event-Subscriptions, sofortiges Re-Rooming, Push-Audiences, gruppen-/eventgebundene Kiosk-Tokens, Arcade-Streams, Kontextanzeige und Zwei-Tab-E2E. Erst danach Flag-Freigabeentscheidung.
7. Phase 6 optional: Gäste, Organizer, Export/Löschfristen, Break-glass und Korrekturwerkzeuge. Offener Rest aus alter Phase 3: zusätzliche DELETE-UI/-Routen für Vote-Runden, Draws, einzelne Play-Sessions und Broadcasts sinnvoll in die zuständigen Cluster einordnen.

## Offene Reviews, CI und Blocker

- Alle aktuellen Pflichtchecks von #197–#201 sind grün: Server, Browser-E2E, Agent und Runtime-Image; `publish`/`deploy` wurden bei PRs erwartungsgemäß übersprungen. Alle fünf melden `CLEAN`; keine formale `reviewDecision`/Approval ist gesetzt.
- #197: GitHub führt 27 unaufgelöste Inline-Threads (15 outdated, 12 nicht outdated). Das Owner-Re-Review am Head bestätigt die P1/P2-Funde als behoben und „LGTM“, aber die Threads wurden nicht aufgelöst. Vor Merge gegen Head einzeln verifizieren/auflösen; keine Codeänderung allein wegen des Threadstatus.
- #199: keine Inline-Threads, positives Owner-Review. Nicht blockierende Follow-ups: globale Login-Namen können gruppenübergreifend per 409 enumerierbar sein; das globale Auth-Limit kann alle Gruppen gemeinsam drosseln; Betreiber-/Löschpflichten vor breiter externer Nutzung konkretisieren.
- #198/#200/#201: keine Review-Kommentare; fehlendes fachliches/Security-Review ist ihr Abschlussblocker. Scope-Grenze Push/Arcade zwischen 5c und 5e im nächsten Planungs-PR explizit festhalten.

## Migration und Kompatibilität

- `AUTH_MODE` bleibt standardmäßig `legacy`; `required` ignoriert Shared `ACCESS_TOKEN`/Admin-PIN und verlangt in Produktion `ADMIN_RECOVERY_CODE`. Für Cutover zusätzlich separaten `KIOSK_TOKEN` setzen; `ACCESS_TOKEN` für Rollback auf alte Images in der nicht versionierten `.env` behalten. Ablauf: Backup, Recovery-Claim des ersten bestehenden Profils, danach persönliche Claim-Links verteilen.
- Bestehende Spieler/Profile/Historie bleiben erhalten; unbeanspruchte Konten haben keinen Login bis zum Claim. Passwortänderung/Reset/Deaktivierung invalidiert relevante Sessions, Sockets und Push-Abos. Agenten bleiben über den globalen, geheimen `api_key` kompatibel; keine Sessionpflicht am Agent-Endpoint.
- Migrationen: #197 v26 Auth, v27 Invite-FK-Reparatur (auch für bereits gelaufene alte v26), v28 Reauth, v29 Deaktivierung/Audit; #199 v30 Gruppenfundament, v31 Autorisierung; #200 v32 Katalog/Presence; #201 v33 Wettbewerb. Migrationen müssen in dieser Reihenfolge bleiben, Legacy-Fixtures/idempotenten Neustart/Fehler-Rollback abdecken; produktive DB nie neu erzeugen.
- v30 migriert aktive Bestandsnutzer und Daten in `default-group` und übernimmt bestehendes Tracking-Verhalten; neue Gruppen starten Tracking-off. Sentinel und globaler Tracking-Schalter bleiben interimistisch, bis 5c/5d sie sicher ablösen. `MULTI_GROUPS_ENABLED=0` verhindert bis dahin zusätzliche Produktivgruppen.
- Image-Rollback ist betrieblich vorgesehen; Schema-Rückmigrationen sind nicht zugesagt. Vor Cutover/Stack-Merges SQLite-Backup anlegen und ältere Images nur mit erhaltenem `ACCESS_TOKEN` starten.

## Relevante Dateien und Konzeptabschnitte

- Zielkonzept: [Domänenmodell](../KONZEPT-USER-MANAGEMENT.md#3-domänenmodell), [Autorisierung](../KONZEPT-USER-MANAGEMENT.md#5-gruppenkontext-und-autorisierung), [Tracking](../KONZEPT-USER-MANAGEMENT.md#8-tracking-und-privatsphäre), [Migration](../KONZEPT-USER-MANAGEMENT.md#11-sichere-bestandsmigration), [Plan](../KONZEPT-USER-MANAGEMENT.md#13-umsetzungsplan), [Testmatrix](../KONZEPT-USER-MANAGEMENT.md#14-verbindliche-testmatrix). Bis #198 gemergt ist, diese Abschnitte direkt im PR-Branch lesen.
- Auth/Cutover: [`server/src/config.ts`](../../server/src/config.ts), [`server/src/accounts.ts`](../../server/src/accounts.ts), [`server/src/sessions.ts`](../../server/src/sessions.ts), [`server/src/routes/auth.ts`](../../server/src/routes/auth.ts), [`server/OPERATIONS.md`](../../server/OPERATIONS.md).
- Tenant-Grundlage: [`server/src/db.ts`](../../server/src/db.ts), [`server/src/groups.ts`](../../server/src/groups.ts), [`server/src/groupAuthorization.ts`](../../server/src/groupAuthorization.ts), [`server/src/routes/groups.ts`](../../server/src/routes/groups.ts), [`server/src/events.ts`](../../server/src/events.ts), [`server/src/realtime.ts`](../../server/src/realtime.ts), [`server/TESTING.md`](../../server/TESTING.md).

## Verifikation

- Bereits berichtet: #197 `697 + 40` Unit/Integration/Frontend und `42/42` E2E; #199 `701 + 40` und `43/43` E2E; #200 `702 + 40`; #201 `703 + 40`. Für #200/#201 ist zusätzlich der jeweilige Browser-E2E-CI-Check grün. Diese Ergebnisse gelten für die jeweiligen Heads, nicht automatisch nach Retarget/Rebase.
- Nach jedem Stack-Merge/Retarget: `npm run lint`, `npm run build`, `npm test`, `npm run check:tokens`, `npm run format:check`; bei Frontend-/Ablaufänderungen `npm run test:e2e`. CI vollständig grün abwarten.
- Jede 5c-Ressourcenart braucht die Zwei-Gruppen-Matrix: eigener Zugriff, bekannte Fremd-ID `404`, Rollen-Bypass `403`, manipulierte Query/Body/URL, Aggregate/Export-Leaks und Migration aus Legacy-Daten. 5d zusätzlich Agent/Consent/Zeitgrenzen/Races; 5e Socket/Push/Kiosk/Arcade und parallele Tabs.

## Arbeitsregeln für Folge-Chats

- Pro Phase oder Cluster einen eigenen Chat verwenden und zu Beginn Branch, Base-Branch und PR nennen.
- Nicht gleichzeitig mit Codex und Claude Code denselben Branch bearbeiten; vor Start Remote-Head und sauberen Arbeitsbaum prüfen.
- Bestehende Entscheidungen nicht ohne neue Evidenz wieder öffnen. Offene Fragen klar als solche behandeln.
- Keine Produktivfreigabe von `MULTI_GROUPS_ENABLED` vor vollständigem 5c–5e-Nachweis.
- Diese Datei nach jedem Merge, Retarget oder wesentlichen Review aktualisieren; Status „gemergt“ nur mit verifiziertem Merge-Commit setzen.

## Nächster empfohlener Arbeitsschritt

Neuen Chat für **PR #197 Abschluss** starten: Head `3b3806f` gegen aktuelles `main` prüfen, die 27 noch offenen GitHub-Threads anhand des aktuellen Codes triagieren/auflösen, Pflichtchecks bestätigen und nur bei weiterhin blockerfreiem Stand den Merge zur Freigabe vorlegen. Danach in einem eigenen Chat #198 auf den gemergten #197-Stand aktualisieren und reviewen.
