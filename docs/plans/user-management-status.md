# User-Management – verifizierter Koordinationsabschluss

Stand: 2026-07-16. Verifiziert gegen Git, GitHub und die PR-Heads. Statuswörter bleiben getrennt: **implementiert**, **getestet**, **reviewt**, **gemergt**. Es gibt keine ungeklärten Widersprüche mehr; verbleibende Punkte sind konkrete Blocker oder terminierte Folgeaufträge.

## Abschlusscheckliste

- [x] Übergabe dauerhaft gesichert: PR [#204](https://github.com/blorbeer-cmd/LAN_2026/pull/204), Squash-Merge `49e95ac`.
- [x] Heads, Bases, Draft-Status, Merge-State, CI und Commit-Ancestry von #197–#201 verifiziert.
- [x] Rev. 2 und Rev. 4 vollständig verglichen; verbindliche Harmonisierung festgelegt.
- [x] Alle 27 Review-Threads von #197 thread-aware geprüft und aufgelöst.
- [x] #198, #200 und #201 fachlich und gegen Tenant-/Security-Anforderungen reviewt.
- [x] Grenzen 5c/5d/5e und die Agent-Zwischenlösung verbindlich geklärt.
- [x] Produktentscheidungen, spätere Freigabe-Gates und Folgeaufträge festgelegt.

## Verifizierter PR-Stack

| PR | Verifizierter Head → Base | Zustand | Umsetzung / Tests / Review / Merge | Ergebnis und nächster Schritt |
|---|---|---|---|---|
| [#197](https://github.com/blorbeer-cmd/LAN_2026/pull/197) | `3b3806f` → `main` (`49e95ac`; Merge-Base `ff2f1e6`) | Ready, `CLEAN`, mergebar, Pflicht-CI grün | Phasen 1–4 implementiert, getestet, reviewt, nicht gemergt | **reviewt und blockerfrei**; 24 Auth-Threads nachweislich behoben, 3 Split-Threads obsolet, 0 offen. Nach ausdrücklicher Merge-Freigabe mergen. |
| [#198](https://github.com/blorbeer-cmd/LAN_2026/pull/198) | `d0f0446` → `claude/user-management-auth-core` bei altem Base-OID `d80f151` | Draft, `CLEAN`, CI grün | Rev. 4 erstellt und jetzt reviewt, nicht gemergt | **reviewt, konkrete Blocker:** veraltete #197-Ancestry und unten genannte Konzeptkorrekturen. Nach #197 auf neues `main` setzen, fokussierten Dokument-Diff herstellen, retargeten, erneut reviewen. |
| [#199](https://github.com/blorbeer-cmd/LAN_2026/pull/199) | `a48d659` → `claude/user-management-auth-core` `3b3806f` | Ready, `CLEAN`, CI grün; veralteter Draft-Hinweis im PR-Text korrigiert | 5a–5b implementiert, getestet, reviewt, nicht gemergt | **reviewt und blockerfrei unter `MULTI_GROUPS_ENABLED=0`**; nach #198 einzigartige drei Commits auf neues `main` setzen, Rev. 4 erhalten, retargeten und CI wiederholen. |
| [#200](https://github.com/blorbeer-cmd/LAN_2026/pull/200) | `b75474f` → `codex/group-management` `a48d659` | Draft, `CLEAN`, CI grün | 5c Cluster 1 implementiert/getestet/reviewt, nicht gemergt | **reviewt, konkrete Blocker:** Gruppenrollen, Cluster-1-Leser und Arcade-Backfill; eigener Fixauftrag vor Ready. Danach nach #199 auf neues `main` setzen und retargeten. |
| [#201](https://github.com/blorbeer-cmd/LAN_2026/pull/201) | `6bc8150` → `claude/group-scoping-catalog-presence` `b75474f` | Draft, `CLEAN`, CI grün | 5c Cluster 2 implementiert/getestet/reviewt, nicht gemergt | **reviewt, konkrete Blocker:** fremde Spielerreferenzen, gruppenfremder Tracking-Event-Bezug und globale Admin-Guards; eigener Fixauftrag vor Ready. Danach nach #200 auf neues `main` setzen und retargeten. |

Alle Pflichtchecks an den genannten Heads sind grün: Server, Browser-E2E, Agent und Runtime-Image; `publish`/`deploy` wurden erwartungsgemäß übersprungen. Die Ergebnisse gelten nach Rebase/Retarget erst wieder nach erneuter vollständiger CI.

## Verbindliche Merge- und Retarget-Strategie

Reihenfolge: **#197 → #198 → #199 → #200 → #201**. Kein Implementierungs-PR wird ohne ausdrückliche Zustimmung gemergt.

1. #197 darf nach Freigabe direkt nach `main`; vor Merge nur aktuellen `main`-Stand und CI erneut prüfen.
2. #198 enthält #197 nur bis `d80f151`; Grund ist der frühere Synchronisationszeitpunkt. Die späteren 5a/5b-Reverts und der finale Review-Fix `3b3806f` fehlen. Nach #197-Merge den Rev.-4-Dokumentstand als fokussierten Diff auf neuem `main` herstellen, erst dann Base auf `main` setzen.
3. Nach #198-Merge #199 nicht nur retargeten: seine drei einzigartigen Commits auf das neue `main` rebasen/cherry-picken, damit Rev. 2 nicht Rev. 4 überschreibt; danach Base `main`, Diff- und CI-Prüfung.
4. Nach #199-Merge nur den einzigartigen #200-Commit auf neues `main` setzen; Base `main`, vollständige CI. Nach #200 entsprechend nur den einzigartigen #201-Commit.
5. Bei Squash-Merges ist jeweils `rebase --onto <neues-main> <alter-parent-head> <child>` beziehungsweise ein äquivalenter sauberer Cherry-pick erforderlich. Reines Retargeten würde Parent-Diffs erneut zeigen.

## Konzeptstand und Review #198

- `main`: Rev. 2 (752 Zeilen); #197 und #199–#201: fortgeschriebene Rev. 2 (778 Zeilen); nur #198: Rev. 4 (719 Zeilen).
- Rev. 4 ist das Zielmodell und mit 5a–5e grundsätzlich umsetzbar. Erwartete Zwischenstände hinter dem Flag sind keine fachlichen Widersprüche.
- Vor Merge muss #198: ASVS ausdrücklich auf stabile Version **5.0.0** pinnen; §16 in entschiedene Regeln/spätere Gates umschreiben; Gruppenrollen statt Instanz-Adminrechte für Fachdaten festschreiben; für jede Spieler-ID in Gruppenressourcen aktive Mitgliedschaft oder einen zulässigen historischen Snapshot verlangen; systemglobale, unveränderliche Arcade-Titeldefinitionen als einzige Katalog-Ausnahme benennen; die unten definierte 5c/5d/5e-Schnittstelle aufnehmen.
- OWASP-Maßstab: früher validierter Tenant-Kontext, Default-deny und Prüfung jedes Requests, tenantgebundene Adminrechte/Queries/Audits sowie Export und vollständiges Offboarding vor externer Nutzung. Referenzen: [Multi-Tenant Security](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html), [Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html), [ASVS 5.0.0](https://github.com/OWASP/ASVS/releases/tag/v5.0.0_release).

## Thread-Triage #197

- Threads 1–21, 24, 25 und 27: **nachweislich behoben** am Head `3b3806f` (URL-Parameter, Cookies, Login-Ambiguität/Bounds, Session/Socket/Push-Invalidierung, Reauth, Credential-Redaction, Kiosk/Backup, Step-up-UI, Recovery, Katalogrechte und Ratings).
- Threads 22, 23 und 26: **durch den 5a/5b-Gruppenmanagement-Split obsolet**; die betroffenen Dateien fehlen im #197-Head und sind in #199 gehärtet.
- Weiterhin actionable: **0**. Doppelt: **0**. GitHub-unaufgelöst nach Triage: **0**. Aussage: **#197 ist mergebar und blockerfrei**.

## Konkrete Review-Blocker

### #200

- Katalogänderungen verwenden teils globale `is_admin`/`requireAdmin`-Rechte, teils keinen Gruppenrollen-Guard. Gruppen-Admins können dadurch ausgeschlossen und normale Mitglieder beziehungsweise Instanz-Admins falsch berechtigt werden. Alle Katalog-, Prozessnamen- und Moderationsmutationen brauchen die 403-Rollenmatrix über `requireGroupRole`.
- Am #200-Head lesen Stats, Analytics, Profilstats, Digest und Export gruppenübergreifend aus Cluster-1-Tabellen. #201 repariert einen Teil bereits, aber #200 ist allein nicht isoliert; die Korrekturen müssen vor dessen Ready-Status im wirksamen Stack nachgewiesen werden.
- Migration 32 leitet `group_id` aus `games` ab. Historische Arcade-`play_sessions`/`live_status_games` bleiben wegen systemglobaler Arcade-Titel `NULL` und verschwinden später aus gruppengefilterten Auswertungen. Backfill über das Event beziehungsweise bereinigtes Schließen ephemerer Live-Zeilen plus Migrationstest ist erforderlich.

### #201

- Matches, Draws und Turniere prüfen übergebene Spieler-IDs nur gegen globale `players`. Der Test nimmt Alice ohne Mitgliedschaft erfolgreich in Gruppe B auf und erzeugt dort Ranglisten-/Exportdaten. Jede referenzierte Person muss aktive Mitgliedschaft derselben Gruppe beziehungsweise zulässige historische Zugehörigkeit haben; fremde IDs liefern 404.
- Neue Matches/Draws/Turniere übernehmen den einzigen globalen `getTrackingEventId()` ohne Nachweis, dass das Event zu `req.group` gehört. Bis 5d ist mindestens eine Same-Group-Invariante nötig; 5d ersetzt dies durch expliziten Gruppen-/Eventkontext.
- Match-/Turnier-Löschungen nutzen globale Instanz-Adminrechte statt Gruppen-Admin/Owner. Zwei-Gruppen- und vertikale 403-Tests fehlen. Die bereits ergänzten Leser/Aggregationen sind ansonsten gruppengefiltert; Arcade-Analytics bleibt bewusst beim Arcade-Cluster.

## Verbindliche Schnittstelle 5c / 5d / 5e

- **5c Daten/REST:** `group_id` und optional `event_id`, Backfill/FKs/Resolver, aktive Mitgliedschaft aller referenzierten Spieler, Gruppenrollen, CRUD, Listen, Aggregationen und Export. Broadcasts, Push-Historie, Info-Board sowie Arcade-Lobbys/Ergebnisse erhalten hier Schema und normale sessiongebundene REST-Isolation. Unveränderliche Arcade-Titeldefinitionen dürfen global sein, niemals Aktivität oder Ergebnisse.
- **5d Tracking/Events:** historisierte Gruppen-/Event-Einwilligungen, Event-Annahme, Zeitgrenzen, `visibility_scope`, proratisierte Auswertung, idempotentes Session-Schließen, parallele Events verschiedener Gruppen und Agent-Fan-out. Der Agent lädt die Vereinigungsmenge erlaubter Prozessnamen, wertet pro Gruppe getrennt aus, schreibt in jede eingewilligte Gruppe und unterstützt paralleles Tracking ohne globalen Event-Singleton.
- **5e Zustellung/öffentliche Flächen:** Socket-Subscribe/Re-Rooming und gruppenspezifische Emits, Push-Empfänger/Mutes/Klickziele, Kiosk-Token und read-only Rooms, Arcade-Lobby-Discovery/Join/Zuschauer/Streams/Kiosk sowie Zwei-Tab-/Zwei-Gruppen-E2E. Keine Zustellung darf nur einer bereits gespeicherten `group_id` vertrauen; Mitgliedschaft/Teilnahme wird beim Versand/Subscribe erneut geprüft.
- Push/Kommunikation: 5c besitzt Datensatz und REST; 5e berechnet Empfänger und liefert aus. Arcade: 5c besitzt Lobby-/Match-/Ergebnisdaten; 5e besitzt Rooms, Zuschauer und Streams. So gibt es weder Doppelarbeit noch Lücke.

## Agent-Zwischenlösung #200

Bei `MULTI_GROUPS_ENABLED=0` ist die Wahl der Gruppe über das einzige globale Tracking-Event für den unterstützten Ein-Gruppenbetrieb akzeptabel: zusätzliche Gruppen, Einladungen und Austritte sind produktiv blockiert, und Berichte werden nur bei aktiver Default-Gruppenmitgliedschaft zugeordnet. Sie leakt oder fehlattribuiert im unterstützten Modus nicht. Sie ist kein Zielmodell und ein harter Flag-Freigabeblocker; 5d muss Fan-out, gruppenbezogene Einwilligungen, mehrere Prozesszuordnungen und paralleles Tracking vollständig ersetzen.

## Verbindliche Produktentscheidungen und spätere Gates

- Gruppenanlage: jedes beanspruchte echte Nicht-Test-Konto; Ersteller wird Owner. Bereits in #199 implementiert. Event-Einladung: aktive Annahme und separate Tracking-Zustimmung in 5d.
- Widerruf stoppt neue Erfassung und schließt Sessions; rechtmäßig erfasste reine Historie bleibt, bis die Person sie separat löscht. Ehemalige Mitglieder verlieren sofort Zugriff; historische Beiträge bleiben für verbleibende Mitglieder sichtbar.
- Namen/Avatare bleiben in V1 global. Veröffentlichte Events derselben Gruppe dürfen sich in V1 nicht zeitlich überschneiden; Entwürfe schon.
- HIBP ist kein #197-Mergeblocker und wird als späterer fail-open k-Anonymity-Check entschieden/umgesetzt. Bis dahin keine behauptete Breach-Password-Prüfung. scrypt-Kosten erst nach asynchroner Umstellung und Zielhardware-Benchmark erhöhen.
- Private Startnutzung: keine automatische Löschfrist. Vor externen Gruppen zwingendes Gate: feste Aufbewahrung, Gruppen- und Kontoexport, überprüfbares Löschen, Betreiberrolle/Datenschutzinformation und Support-/Break-glass-Prozess.
- Global eindeutige Loginnamen mit 409-Enumeration und das instanzweite Auth-Limit sind für die private, flaggeschützte Phase akzeptiert. Vor externer Freigabe müssen neutrale Registrierungsantworten/Invite-Flows und faire, missbrauchsresistente Limits festgelegt und getestet werden.

## Verifikation und Arbeitsregeln

- Berichtete Head-Ergebnisse: #197 `697 + 40`, E2E `42/42`; #199 `701 + 40`, E2E `43/43`; #200 `702 + 40`; #201 `703 + 40`; jeweilige GitHub-Pflicht-CI grün.
- Nach jedem Rebase/Retarget und jedem Blocker-Fix: `npm run lint`, `npm run build`, `npm test`, `npm run check:tokens`, `npm run format:check`, bei Ablauf-/Frontendbezug `npm run test:e2e`; Zwei-Gruppen-Matrix um fremde Spielerreferenzen, Rollen, Aggregationen, Export und Migration ergänzen.
- `MULTI_GROUPS_ENABLED` bleibt bis vollständig blockerfreiem 5c–5e-Nachweis `0`. Nie Codex und Claude Code gleichzeitig auf demselben betroffenen Branch. Keine Implementierungslogik oder Implementierungs-PR-Merges ohne ausdrückliche Zustimmung.

## Geordnete Folgeaufträge

1. #197 nach ausdrücklicher Freigabe und erneuter Live-Prüfung mergen.
2. #198 auf gemergtes #197/`main` harmonisieren, die genannten Konzeptblocker korrigieren, retargeten, reviewen und mergen.
3. #199 auf das neue `main` setzen, Rev. 4 erhalten, retargeten, vollständig testen und zur Merge-Freigabe vorlegen.
4. #200-Blocker in einem fokussierten Fixauftrag beheben; danach Stack-Synchronisierung, vollständige Matrix/CI und Review.
5. #201-Blocker in einem fokussierten Fixauftrag beheben; danach Stack-Synchronisierung, vollständige Matrix/CI und Review.
6. Erst danach getrennte Aufträge für 5c Votes/Drafts, Seating/Pings, Organisation/Kommunikation und Arcade; anschließend 5d und 5e gemäß obiger Schnittstelle.
