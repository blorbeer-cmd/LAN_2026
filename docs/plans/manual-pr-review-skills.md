# Konzept: PR-Reviews gezielt mit Claude und Codex starten

Status: Vorschlag und Pilotvorlagen, 2026-09-05. Dieser Dokumentations-PR ist selbst
der erste manuelle Testfall. Ein erfolgreicher End-to-End-Pilot ist noch nicht belegt.

## Ziel und Bedienung

Der Nutzer startet ein Review direkt im gewünschten Werkzeug und nennt den PR-Link.
Der Reviewer dokumentiert das Ergebnis am PR. Der implementierende Agent kann es dort
anschließend lesen und bewerten. Es braucht keinen anbieterübergreifenden Starter.

| Implementiert mit | Review mit Claude | Review mit Codex |
| --- | --- | --- |
| Claude | Self-Review in frischer Session | Cross-Review |
| Codex | Cross-Review | Self-Review in frischer Session |

Beide persönlichen Skills heißen `pr-review`. Ihre Prüfanleitung ist identisch;
nur die Metadaten für den manuellen Aufruf unterscheiden sich. Sie werden bewusst
unter `docs/review-skills/` bereitgestellt und erst durch Kopieren installiert:

- [Claude-Vorlage](../review-skills/claude/pr-review/SKILL.md)
- [Codex-Vorlage](../review-skills/codex/pr-review/SKILL.md)
- [Codex-Aufrufkonfiguration](../review-skills/codex/pr-review/agents/openai.yaml)

## Ein Review, ein dokumentiertes Ergebnis

1. Neue Unterhaltung im passenden Projekt öffnen, ohne Implementierungs-Chatverlauf.
2. Skill mit vollständigem PR-Link starten. Ein Draft ist ein zulässiges Review-Ziel.
3. Repository, Base und Head aus GitHub ermitteln; Anforderungen, Regeln, vollständigen
   Diff, relevante Aufrufer und vorhandene Tests lesen.
4. Konkrete Findings und Grenzen dokumentieren. Auch ein Dokumentations-PR wird inhaltlich
   geprüft: ausführbare Anleitungen, Widersprüche, fehlende Voraussetzungen und Übergänge.
5. Ergebnis als COMMENT-Review mit geprüftem Commit und möglichst auflösbaren
   Inline-Kommentaren veröffentlichen. Es gibt weder Approval noch automatischen Merge.
6. Der implementierende Agent beurteilt Findings anhand des Codes. Ein Review-Aufruf
   allein ist kein neuer Fix-Auftrag. Bereits autorisierte Fix-Arbeit bleibt autorisiert.

Eine neue Session trennt den Gesprächskontext. Ein Skilltext erzwingt aber weder Sandbox
noch eingeschränkte Credentials. Review-Analyse und Veröffentlichung haben unterschiedliche
Rechte: Die Analyse soll Code nur lesen; der veröffentlichende Teil braucht PR-Kommentarrechte.
Bestehende, strengere Repository-Vorgaben zur Isolation gelten weiterhin. Wo sie technisch
nicht erfüllt werden können, endet der Pilot mit einem nachvollziehbaren Hindernis und
keinem behaupteten bestandenen Review. Die Vorlagen sind kein fertiger Sandbox-Launcher.

Ergebnisse nennen tatsächlichen Anbieter, geprüften vollständigen Head-SHA, Base-SHA,
Prüfumfang, Findings und Einschränkungen. Cross/Self wird nur aus verlässlicher Angabe
des Implementierers abgeleitet; der GitHub-Kommentarautor allein beweist den Anbieter nicht.
Ein neuer Commit entwertet das Ergebnis als Urteil über den aktuellen PR-Stand. Nach einer
Änderung startet der Nutzer das nächste Review bewusst erneut.

## Installation auf diesem Windows-Rechner

GitHub muss im jeweiligen Werkzeug lesbar sein; zum Veröffentlichen sind PR-Schreibrechte
nötig. Eine verbundene GitHub-App oder eine funktionierende GitHub-CLI genügt. Ein fehlender
Zugriff wird behoben, bevor der Pilot ein veröffentlichtes Ergebnis erwarten kann.

Die folgenden Befehle in PowerShell im Root des ausgecheckten Konzept-Branches ausführen.
Für den ersten Pilot steht ein eigener Worktree unter
`C:\Users\BOB\LAN_2026-review-concept` auf `codex/manual-pr-review-concept` bereit.
Vorhandene persönliche Skills werden nicht überschrieben; bei einem vorhandenen Ziel
zuerst die alte und neue Fassung im Editor vergleichen und bewusst aktualisieren.

```powershell
Set-Location -LiteralPath 'C:\Users\BOB\LAN_2026-review-concept'
$reviewSources = Join-Path (Get-Location).Path 'docs/review-skills'
$claudeSkills = Join-Path $env:USERPROFILE '.claude/skills'
$codexSkills = Join-Path $env:USERPROFILE '.agents/skills'
$claudeTarget = Join-Path $claudeSkills 'pr-review'
$codexTarget = Join-Path $codexSkills 'pr-review'

if ((Test-Path -LiteralPath $claudeTarget) -or (Test-Path -LiteralPath $codexTarget)) {
    throw 'pr-review ist bereits vorhanden. Vor dem Aktualisieren Fassungen vergleichen.'
}

New-Item -ItemType Directory -Force -Path $claudeSkills, $codexSkills | Out-Null
Copy-Item -LiteralPath (Join-Path $reviewSources 'claude/pr-review') -Destination $claudeTarget -Recurse
Copy-Item -LiteralPath (Join-Path $reviewSources 'codex/pr-review') -Destination $codexTarget -Recurse
```

Danach beide Werkzeuge neu öffnen. Erwartete Dateien:

```text
C:\Users\BOB\.claude\skills\pr-review\SKILL.md
C:\Users\BOB\.agents\skills\pr-review\SKILL.md
C:\Users\BOB\.agents\skills\pr-review\agents\openai.yaml
```

Es wird nichts automatisch im persönlichen Profil installiert, wenn dieser PR gemergt wird.
Die beiden selbstständigen Vorlagen müssen bei späteren Änderungen gemeinsam gepflegt werden.

## Direkt an diesem PR testen

Die tatsächliche PR-URL steht in der PR-Beschreibung. In einer neuen Unterhaltung eingeben
und `PR-URL` durch diese URL ersetzen:

```text
Claude Code: /pr-review PR-URL
Codex:      $pr-review PR-URL
```

`Claude Code:` und `Codex:` sind Beschriftungen und werden nicht mit eingegeben.
Der Codex-Aufruf kann alternativ über die Skill-Auswahl erfolgen. Für einen reinen
Erkennungstest ergänzen: „Nur Skill laden und Ablauf erläutern, noch kein Review starten
und nichts veröffentlichen.“ Diese Einschränkung hat Vorrang vor der normalen Veröffentlichung.

Abnahme durch den Nutzer:

- Der Skill wird in beiden Werkzeugen gefunden und startet nur auf ausdrücklichen Aufruf.
- Der vollständige Dokumentations-Diff wird zum korrekten Head geprüft, einschließlich
  Installationsanleitung, Skillvorlagen und Grenzen des Piloten.
- Ergebnis und mögliche Inline-Findings sind am richtigen PR lesbar und mit dem geprüften
  Commit verbunden. Der Agent liefert einen funktionierenden Ergebnislink zurück.
- Auch ohne Findings wird ein ausdrückliches Ergebnis veröffentlicht. Eine fehlende
  Isolation oder ein Zugriffsfehler wird als unvollständige Prüfung gemeldet.
- Ein bereits vorhandenes gleiches Ergebnis wird nicht versehentlich doppelt veröffentlicht.
- Ein während der Prüfung geänderter Head führt zu einem Stopp mit Hinweis, nicht zu einem
  positiven Urteil über ungeprüften Code. Der Nutzer kann das Review neu starten.
- Weder Code noch Labels, Checks, Branch-Schutz oder Merge-Zustand werden durch den Skill geändert.

Der erste Pilot belegt Installation und Review dieses Dokumentations-PRs. Er beweist noch
keine Erkennungsqualität bei Produktionsfehlern; dafür später einen passenden Code-PR verwenden.

## Optional: Ergebnis in der ursprünglichen Claude-Session empfangen

Ein lokal angezeigtes Codex-Ergebnis ist für Claude nicht automatisch sichtbar. Das
veröffentlichte GitHub-Ergebnis ist die gemeinsame Übergabe. Nach ausdrücklichem Auftrag kann
Claude in seiner geöffneten Implementierungs-Session mit `/loop` nachsehen. Beispielsweise
folgenden Auftrag mit tatsächlichem PR-Link, erwartetem Reviewer und vollständigem SHA verwenden:

```text
/loop 5m Prüfe ausschließlich PR-URL auf ein neues vollständiges Review von REVIEWER
für HEAD-SHA. Lies Reviews, Inline-Kommentare und normale PR-Kommentare. Prüfe Autor
und ausgewiesenen Anbieter; bei unklarer Herkunft frage nach. Bleibe ohne Änderung still.
Sobald das Ergebnis vorliegt, beende diesen Warteauftrag und bewerte jedes Finding
einmal am aktuellen Code. Berichte berechtigt, bereits behoben oder begründet abgelehnt.
Dieser Warteauftrag autorisiert nur Prüfung und Bericht. Beende ihn ebenfalls bei
Head-Wechsel, geschlossenem/gemergtem PR, Zugriffsfehler oder spätestens nach zwei Stunden
und melde den Grund. Lösche dafür den zu diesem Auftrag gehörenden geplanten Task.
```

Die Intervalle wecken Claude und können Kontingent verbrauchen. Rechner und Session müssen
geöffnet bleiben; fällige Prüfungen warten gegebenenfalls auf das Ende eines laufenden Turns.
Ein Stopp ist hier Teil des Auftrags und keine allein durch den Skill erzwungene Garantie.
Für Fixes folgt ein eigener Auftrag oder die bereits bestehende Implementierungs-Autorisierung.
Eine dauerhafte Überwachung aller PRs oder eine automatische Review-Fix-Schleife ist nicht nötig.

## Übergang von der bestehenden Pipeline

Dieser Vorschlag löst das
[bestehende Pipeline-Konzept](auto-feature-to-deploy-pipeline.md) noch nicht ab.
Die dortigen Regeln, Required Checks und Review-Nachweise gelten bis zu einer ausdrücklich
beschlossenen Umstellung. Insbesondere ist ein gewöhnlicher Skill-Kommentar kein Ersatz für
einen akzeptierten Pipeline-Nachweis; die Vorlagen erzeugen keine solchen Erfolgsmarker.

Nach dem Pilot folgt ein eigener Rückbauauftrag:

1. Pilot-Ergebnisse und das gewünschte Maß an technisch erzwungener Isolation festhalten.
2. Aktiven GitHub-Branch-Schutz, laufende Reviews, Workflow-Trigger und externe Monitore
   tatsächlich inventarisieren; historische Dokumentation ist dafür kein Zustandsnachweis.
3. Ablösung des eigenen Pipeline-Pflichtchecks und der bisherigen Nachweispflicht mit dem
   Nutzer konkret festlegen. Normale Build-/Testchecks und menschlicher Merge bleiben erhalten.
4. Regeln, PR-Vorlage, zuständige Automations-Workflows und Monitore abgestimmt umstellen,
   damit weder ein verwaister Pflichtcheck noch doppelte Review-Aufträge entstehen.
5. Anschließend ausschließlich unbenutzte Pipeline-Skripte und deren Tests entfernen.

Die skillbasierte Veröffentlichung braucht keine neue Zustandsmaschine, keine automatischen
Anbieterwechsel und keinen Kommentar-Parser als Merge-Freigabe. GitHub bleibt Ablage und
Diskussionsort. Die endgültige Merge-Entscheidung trifft der Nutzer.

## Quellen und Validierung

Stand der herangezogenen offiziellen Dokumentation: 2026-09-05.

- [Codex: Skills, persönliche Pfade und explizite Aufrufe](https://learn.chatgpt.com/docs/build-skills)
- [Claude Code: Skills und manuelle Aktivierung](https://code.claude.com/docs/en/skills)
- [Claude Code: zeitlich begrenzte Aufgaben in einer Session](https://code.claude.com/docs/en/scheduled-tasks)

Vor Veröffentlichung dieses Konzept-PRs werden YAML-Metadaten, interne Links, die
PowerShell-Installationsanleitung in einem temporären Profil und die Übereinstimmung der
beiden Prüfanleitungen kontrolliert. Der echte Review- und Veröffentlichungspilot erfolgt
anschließend durch den Nutzer; eine statische Prüfung belegt ihn nicht.
