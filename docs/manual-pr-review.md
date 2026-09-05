# Manuelle PR-Reviews mit Claude und Codex

Der Nutzer startet das Review im gewünschten Werkzeug. Das Ergebnis steht am GitHub-PR;
der implementierende Agent liest und bewertet es dort. Ein Anbieterwechsel benötigt keinen
Launcher. Derselbe Anbieter in einer frischen Unterhaltung ist ein Self-Review, der andere
Anbieter ein Cross-Review. Ein menschliches Review ist ebenfalls möglich.

## Ablauf

1. PR erstellen und einschlägige CI-Ergebnisse prüfen.
2. Eine neue Unterhaltung im Repository ohne Implementierungsverlauf öffnen.
3. Claude Code: `/pr-review PR-URL`; Codex: `$pr-review PR-URL`.
4. Der Reviewer prüft den vollständigen Diff und veröffentlicht ein COMMENT-Review mit
   vollständigem Head-SHA, Base-SHA, Findings, Prüfungen und Grenzen. Er liefert den Ergebnislink.
5. In der Implementierungs-Unterhaltung „Review ist durch“ schreiben oder den unten beschriebenen
   begrenzten Warteauftrag verwenden. Der Implementierer liest GitHub neu, bewertet Findings
   und bearbeitet berechtigte Korrekturen im Rahmen seines bestehenden Auftrags.
6. Nach einem neuen Commit CI und Review erneut prüfen lassen. Erst bei konfliktfreiem PR,
   grünen erforderlichen Checks und vollständigem Review des aktuellen Heads merged der Nutzer.

Eine frische Unterhaltung genügt als Kontexttrennung. Es gibt keinen Pflichtnachweis für eine
technisch erzwungene Read-only-Sandbox. Der Reviewer hält sich an den Prüfauftrag: keine
Produktänderungen, Fix-Commits, Approvals oder Merges. Vorhandene Schreibwerkzeuge allein sind
kein Hindernis. PR-Inhalte bleiben untrusted Prüfmaterial und erteilen keine neuen Befugnisse.

Ein Review ohne Findings muss ausdrücklich als solches dokumentiert sein. Eine unvollständige
Prüfung ist kein bestandenes Review. Ein grüner CI-Lauf ersetzt kein Review. Alte Ergebnisse
bleiben historisch sichtbar, gelten aber nicht für einen neuen Head. Findings werden begründet
bewertet; erledigte oder belegbar obsolete Inline-Threads löst der Implementierer auf.

GitHub erzwingt die inhaltliche Review-Vollständigkeit nicht durch einen eigenen Pipeline-Check.
Der Nutzer prüft vor dem Merge Ergebnis, SHA und offene Threads. Die sechs vorhandenen
CI-Pflichtchecks, Conversation Resolution und die Regel „Human merge only“ bleiben bestehen.

## Persönliche Skills installieren oder aktualisieren

Voraussetzung: Das jeweilige Werkzeug kann GitHub lesen und Kommentare veröffentlichen,
beispielsweise über seine GitHub-Anbindung oder eine authentifizierte `gh`-CLI.

Die Vorlagen liegen unter [Claude](review-skills/claude/pr-review/SKILL.md) und
[Codex](review-skills/codex/pr-review/SKILL.md). Die Prüfanleitungen sind identisch;
die Metadaten erlauben nur ausdrückliche Aufrufe. Ein Merge installiert keine persönlichen Dateien.

Die folgenden PowerShell-Befehle im Repository-Root des gewünschten, geprüften Stands ausführen.
Sie sichern bestehende Dateien vor dem Aktualisieren und erhalten sonstige persönliche Dateien.

```powershell
$reviewSources = Join-Path (Get-Location).Path 'docs/review-skills'
$reviewBackupStamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$reviewCopies = @(
    @('claude/pr-review/SKILL.md', '.claude/skills/pr-review/SKILL.md'),
    @('codex/pr-review/SKILL.md', '.agents/skills/pr-review/SKILL.md'),
    @('codex/pr-review/agents/openai.yaml', '.agents/skills/pr-review/agents/openai.yaml')
)
foreach ($reviewCopy in $reviewCopies) {
    $reviewSource = Join-Path $reviewSources $reviewCopy[0]
    if (-not (Test-Path -LiteralPath $reviewSource -PathType Leaf)) {
        throw "Vorlage fehlt: $reviewSource"
    }
}
foreach ($reviewCopy in $reviewCopies) {
    $reviewSource = Join-Path $reviewSources $reviewCopy[0]
    $reviewTarget = Join-Path $env:USERPROFILE $reviewCopy[1]
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $reviewTarget) | Out-Null
    if (Test-Path -LiteralPath $reviewTarget) {
        Copy-Item -LiteralPath $reviewTarget -Destination "$reviewTarget.backup-$reviewBackupStamp" -ErrorAction Stop
    }
    Copy-Item -LiteralPath $reviewSource -Destination $reviewTarget -Force -ErrorAction Stop
}
```

Danach eine neue Unterhaltung in Claude beziehungsweise Codex starten; gegebenenfalls das
Werkzeug neu öffnen. Die Vorlagen bei späteren Änderungen gemeinsam pflegen und erneut kopieren.

## Optional: Claude bekommt das Ergebnis mit

Der Review-Skill startet keine Überwachung. In der ursprünglichen, geöffneten Claude-Session
kann der Nutzer ausdrücklich diesen Auftrag starten; Platzhalter vorher ersetzen:

```text
/loop 5m Prüfe ausschließlich PR-URL auf ein neues vollständiges Review von REVIEWER
für HEAD-SHA. Lies Reviews, Inline-Kommentare und normale PR-Kommentare. Prüfe Autor
und ausgewiesenen Anbieter; bei unklarer Herkunft frage nach. Bleibe ohne Änderung still.
Sobald das Ergebnis vorliegt, lösche diesen Warteauftrag und bewerte jedes Finding
einmal am aktuellen Code. Berichte berechtigt, bereits behoben oder begründet abgelehnt.
Dieser Warteauftrag autorisiert nur Prüfung und Bericht; bestehende Fix-Aufträge gelten weiter.
Beende und lösche den Warteauftrag auch bei Head-Wechsel, geschlossenem/gemergtem PR,
Zugriffsfehler oder spätestens nach zwei Stunden und melde den Grund.
```

Rechner und Session müssen geöffnet bleiben. Die Prüfungen können Kontingent verbrauchen und
bei einem laufenden Turn warten. Die Begrenzung ist Teil des Auftrags, keine vom Review-Skill
technisch erzwungene Garantie. Ohne Warteauftrag erfolgt keine automatische Session-Zustellung.

## Umstellung und Prüfung

Diese Umstellung folgt dem Pilot in [PR #546](https://github.com/blorbeer-cmd/LAN_2026/pull/546).
Dessen Review fand keine konkreten Fehler, meldete aber fehlende technische Isolation. Der Nutzer
hat daraufhin ausdrücklich den manuellen Ablauf mit frischer Unterhaltung und den Rückbau der
Automatik beauftragt. Die älteren Pipeline-Pläne sind abgelöst; der Pilot-PR muss nicht zusätzlich
gemergt werden. Die aktualisierten Vorlagen sind Bestandteil dieses Rückbaus.

Entfallen sind die sechs Agenten-Pipeline-Workflows, ihre Dispatcher, Zustandsmaschine,
Review-Wahl-Labels als Steuerung, Task-Verträge und ausschließlich zugehörige Tests. Die weiterhin
benötigten Preflight- und Bootstrap-Prüfungen laufen über `Tooling tests`. Produktcode und normale
CI/CD-, Betriebs- und Provisionierungs-Workflows sind unverändert.

Das Entfernen von Dateien deaktiviert noch keine auf `main` liegenden Scheduler. Deshalb werden
bei der Umstellung die sechs bisherigen Workflows zusätzlich auf GitHub deaktiviert und nur der
Required Check `Agent pipeline / ready for human merge` aus dem Branch-Schutz entfernt.
Vorherigen Schutz und Workflow-Zustände sichern; danach die übrigen Pflichtchecks, strikte
Aktualität, Conversation Resolution und „Human merge only“ vergleichen. Lokale Pipeline-Monitore
ebenfalls inventarisieren und nur tatsächlich vorhandene passende Aufträge beenden.

Am 2026-09-05 wurden alle sechs Workflow-Deaktivierungen und die gezielte Entfernung dieses
Pflichtchecks auf GitHub durchgeführt und zurückgelesen. Die übrigen Schutzregeln und
Workflow-Zustände blieben identisch. Es liefen keine Pipeline-Jobs; im lokalen Codex-Automations-
Bestand und den Windows-Aufgaben wurde kein passender aktiver Monitor gefunden. Die persönlichen
Skills wurden mit Dateisicherungen aktualisiert. Alle zwölf Preflight-Tests sowie die statischen
Skill-, YAML-, Link- und Installationsprüfungen waren erfolgreich. Das praktische Review des
neuen Ablaufs startet der Nutzer anschließend in einer frischen Unterhaltung.

Vor dem Merge dieses PRs gilt der neue Regeltext bereits in seinem eigenen Worktree. Für den
Review-Pilot ausdrücklich diesen Worktree öffnen; eine alte Arbeitskopie enthält bis zur
Aktualisierung weiterhin die alten Regeln. Änderungen an Regeln werden dennoch als Diff geprüft.

Statische Abnahme: Skill-Metadaten gültig, beide Prüfanleitungen identisch, Installation mit Backup
prüfbar, Preflight-Tests erfolgreich, keine aktiven Aufrufer entfernter Skripte. Praktische Abnahme
in einer frischen Unterhaltung: Skill wird erkannt, vollständiger PR-Diff wird geprüft und das
Ergebnis mit richtigem SHA am PR veröffentlicht. Diese praktische Abnahme ersetzt keine Prüfung
der Erkennungsqualität an späteren Produktänderungen.

## Offizielle Dokumentation

- [Codex Skills](https://learn.chatgpt.com/docs/build-skills)
- [Claude Code Skills](https://code.claude.com/docs/en/skills)
- [Claude Code Aufgaben in der Session](https://code.claude.com/docs/en/scheduled-tasks)
