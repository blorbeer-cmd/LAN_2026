# Paket 5: Inventar und Einzelklassifikation

Ausgangsbaum ist der finale Paket-4-Merge aus PR #623:
`00fb17224c003d5771ed4d7b308a98b137e67a1b`. Er war vor Beginn gemergt und ist Vorfahr
des eigenen Branches `codex/frontend-package-5`. Historische Zahlen wie 83/36 sind kein Sollwert.

| Ergebnis | Paket-4-Ausgangsbaum | Paket-5-Abschlussbaum |
| --- | ---: | ---: |
| Geometriekandidaten, pro Deklaration | 81 | 77 |
| Farbkandidaten, pro Deklaration | 35 | 35 |
| Unzugeordnete Komponentenbefunde im Check | 158 | 0 |
| Registrydiagnosen im Check | 152 | 0 |

Die 158 initial unzugeordneten Komponentenbefunde sind keine pauschale Migrationsliste.
Die Einzelprüfung unterscheidet vorhandene zulässige Besitzer, dauerhaft begründete Varianten,
eine bereits befristet erfasste Migration, tatsächliche Verstöße und statische Fehlkandidaten.
Die 152 Registrydiagnosen erfassen fehlende explizite Vertragsreferenzen, den bislang ohne
statischen Aufruferbeleg geführten Poll-Choice-Eintrag sowie 63 dynamische Control-Aufrufer.
Sie werden durch konkrete Zuordnung behoben, ohne dafür Produktcode zu migrieren.

| Fachliche Klassifikation aller Ausgangsbefunde | Anzahl |
| --- | ---: |
| Zulässiger Komponentenbesitzer | 1534 |
| Permanente Variante | 116 |
| Befristete Ausnahme | 1 |
| Tatsächlicher Verstoß | 65 |
| Statischer Fehlkandidat | 4 |

Diese Zahlen zählen Befundzeilen, nicht Dateien oder unabhängige UI-Fehler: eine CSS-Deklaration
kann mehrere Selektoren betreffen, ein Aufrufer mehrere Klassen. Die Kandidatenzählung bleibt
deklarationsbezogen. Ein Kandidat außerhalb eines Control-Subjekts bleibt ein gezählter
Literalkandidat; seine Kennzeichnung als statischer Fehlkandidat bezieht sich auf den
Komponentencheck. Die finalen Befundzahlen und der SHA-256-Digest aller Snapshot-Eingaben
stehen in [package-5-summary.json](package-5-summary.json).

## Vollständige Nachweise

- [Ausgangsbefunde mit Einzelklassifikation, Registry-ID, Vertrag, Owner und Entscheidung](package-5-baseline.tsv)
- [Begrenzte Fixes: jede tatsächliche Verletzung und die erfüllte Ausnahme](package-5-fixes.tsv)
- [Abschlussbefunde und Registryzuordnung](package-5-final.tsv)
- Kandidaten: [Ausgang](package-5-baseline-candidates.tsv), [Abschluss](package-5-final-candidates.tsv)
- Vollständiges CSS-Deklarationsinventar einschließlich At-Rules und Suppressionsstatus:
  [Ausgang](package-5-baseline-css.tsv), [Abschluss](package-5-final-css.tsv)
- Statisches JavaScript-Inventar mit Markup, Style-Zuweisungen, EmptyState-Aufrufern und Grenzen:
  [Ausgang](package-5-baseline-js.json), [Abschluss](package-5-final-js.json)
- Einzelne Registrydiagnosen: [Ausgang](package-5-baseline-registry.tsv), [Abschluss](package-5-final-registry.tsv)

Die TSV-Dateien sind Prüfberichte, keine zweite Registry. Sie enthalten ausschließlich
abgeleitete Befunde und Entscheidungen; die maschinenlesbare Zulassung stammt allein aus
`component-registry.mjs`. `initialClassification` bewahrt den rohen Checkbefund;
`classification` und `resolution` dokumentieren die fachliche Einzelprüfung.
Die endgültige Commit-ID wird im PR genannt, um einen Selbstbezug im Commitinhalt zu vermeiden.

## Belegte Fixes und Grenzen

Die Einzelspur erfasst jeden EmptyState-Aufrufer. Nur geschützte Innenstyles wurden durch
`empty-state-compact`, `empty-state-food-items` oder `empty-state-kiosk-loading` ersetzt;
Werte, vorhandene Kontextklassen und reine Außenabstände bleiben erhalten. Die Standardaktion
mit `btn btn-primary btn-sm` ist ein zulässiger Besitzerbefund und wurde nicht migriert.

Weitere bestätigte Verstöße: lokale 24px-Tooltipziele und 17px-Icons in Event-Polls;
vertikales Padding der Arcade-/Mitfahr-Beitrittsaktionen; feste Zielpunktzahlfeldhöhe und
Padding in Arcade; redundantes Inline-`min-width` im Login; Inline-Typografie der Einladungs-URL;
Inline-Typografie und Padding am Prozess-Entfernen-Button. Jeder Fix hat in der Einzelspur
einen Vertrag, eine Registry-ID und einen CSS-Owner. Breiten der bestehenden Layoutspalten
bleiben über konkrete permanente Varianten dokumentiert.

Das Claude-Review am früheren Head `52f1b5d8900b4b527e4288dc12647d3a1378a48a`
belegte zwei weitere Korrekturen: Der Einladungs-URL-Selektor benötigt die Spezifität eines
Textfelds plus seiner Ownerklasse, damit die kompakte Schrift gegen die native Feldbasis greift.
Außerdem gilt `properties` jetzt auch für Komponenten. Die leere Freigabeliste von
`poll-option-link` verhindert eigene geschützte Innenwerte; sein zuvor als Besitzerwert
klassifiziertes `padding: 0` wurde als tatsächlicher Verstoß neu eingeordnet und entfernt.
Auch eine zusätzlich im selben Compound angegebene Basisklasse umgeht diese Grenze nicht.
Die Einzelklassifikation enthält deshalb 65 statt zuvor 64 tatsächliche Ausgangsverstöße.

`legacy-secondary-modifier` war ausschließlich die ungenutzte Klasse am
`data-retry-kiosk-password`-Aufrufer in `views/events.js`. Ihr Löschkriterium ist durch Entfernen
genau dieses Tokens erfüllt; der Eintrag und sein Eigentumsverweis wurden entfernt.
Am Abschlussbaum existieren **keine befristeten Ausnahmen**. Es wurden keine Ausnahmen
angelegt, um offene Verstöße zu verdecken.

Die Registry enthält 71 Komponenten und 71 permanente Varianten mit jeweils genau einem
Vertragsbezug. 63 konkrete dynamische Control-Klassenaufrufe sind den vorhandenen Komponenten
zugeordnet. Dynamische Tags und Eigenschaftsnamen werden nicht geraten; im Anwendungsinventar
dieses Heads wurden keine solchen Formen gefunden. Die Fixtures belegen diese Grenze.
Die beiden `ring.style`-Maße in Onboarding gehören ausdrücklich zum nichtinteraktiven
Markierungsring. Test-Markup bleibt als Fixture im Inventar erkennbar.

## Reproduktion und Abnahme

Aus `server/` erzeugt `node scripts/check-component-contracts.mjs --head --json` den vollständigen
Abschlussbericht. Vor dem Commit erzeugt derselbe Befehl mit `--staged` den Indexbericht.
Für denselben Baum müssen beide JSON-Berichte einschließlich Digest, Kandidaten, Verstößen,
Registrydiagnosen und Exit-Status identisch sein. Das npm-Skript verwendet standardmäßig
`--staged`; ungestagte Änderungen werden nicht gelesen.

Für eine erneute Ausgangsabfrage den oben genannten Paket-4-SHA in einem separaten temporären
Checkout auschecken und von dort den **Paket-5-Scanner über seinen absoluten Pfad** mit `--head`
aufrufen. Dadurch stammen alle CSS-/JS-/Registry-/Vertragsdaten aus dem Ausgangsbaum, während
die Erkennungslogik identisch bleibt. Die Einzelklassifikation verknüpft diesen Rohbericht mit
den dokumentierten Entscheidungen, ohne seine ursprünglichen Registrydiagnosen umzudeuten.

Die Scanner-Fixtures prüfen Besitzer, Kontextoverride, exakte Variante/Ausnahme, Stale-Einträge,
Modifier, Zusatzklassen, Inline-Styles, dynamische Grenzen, Same-line-Suppression und isolierte
Git-Snapshots. Temporäre Repositories werden in `finally` vollständig gelöscht. Index,
Arbeitsbaum und Anwendungszustand dieses Worktrees werden von diesen Tests nicht verändert.

Browserprüfung mit echtem Chromium: Event-Poll-Tooltip und Link bei 320, 390, 512, 720, 1024,
1440 px einschließlich Tastaturfokus; Shell-Control-Fixture bei 320, 390, 512, 640, 720, 1024,
1440 px mit Arcade-Zielpunktzahlfeldern, Beitrittsaktionen und Prozess-Entfernen-Button.
Die kompakte EmptyState-Klasse wurde im bestehenden Vote-/Grouped-Kontext gegen die vorherigen
Inlinewerte vermessen. Der erste Poll-Fokustest setzte nach Mausinteraktion nur `focus()` und
erwartete fälschlich `:focus-visible`; der gezielte Trace-Retry prüft nun echten Tastaturfokus.
Keine Timeouts oder Produktanforderungen wurden gelockert.

Nach dem Review prüft zusätzlich der vorhandene Registrierungslink-Flow in
`authGate.e2e.test.ts` bei 320, 390, 512, 720, 1024 und 1440 px die tatsächlich berechnete
Schriftgröße der Einladungs-URL gegen `--font-size-xs`, die Standardhöhe und Seitenoverflow.
Der Eigenschaftsgrenzen-Test des Scanners reproduzierte den Reviewbefund zunächst rot und
belegt jetzt erlaubte Typografie, verbotene Maße, eine leere Freigabeliste und die ausdrückliche
Übernahme durch eine permanente Variante. Das temporäre Git-Fixture deaktiviert ausschließlich
in seinem eigenen Repository Commit-Signierung und hängt dadurch nicht von einer globalen
Signierkonfiguration ab.

Der gezielte Auth-Trace-Retry bestand alle zwölf Tests. Zuvor scheiterte einmal der
Serverstart vor dem ersten UI-Schritt; beim folgenden Lauf traf die neue Höhenmessung die
neu gestartete Dialoganimation am Viewportwechsel. Der Test wartet jetzt ereignisbezogen
auf das Ende dieser Animation und behält seine unveränderte Höhenanforderung bei. Der
Event-Poll-Ownerflow bestand nach Entfernung des Link-Paddings ebenfalls. Vollständige
Unit-/E2E-Ergebnisse für den Reviewfix und dessen finaler SHA stehen im PR.

Ein weiterer vollständiger Lauf traf in der unveränderten Arcade-Auth-Fixture auf ein
zwischen zwei `boundingBox()`-Aufrufen verschwundenes Lobbyelement. Der aus den Metadaten
gewählte Retry mit `E2E_RETRY_FAILED_ONLY=1 E2E_TRACE=1` führte ausschließlich
`authGateArcade.e2e.test.ts` erneut aus und bestand beide Tests. Anschließend wurde der
vollständige E2E-Lauf nochmals ausgeführt und bestand alle 103 Tests.

Die ausgeführten und nach Änderungen wiederholten Befehle samt finalem Head stehen im PR.
Die statische Prüfung ersetzt keine DOM-/Kaskaden-/Layoutsimulation; ihre Registrybelege müssen
bei geänderten dynamischen Aufrufern mitgepflegt werden. Keine visuellen Baselines wurden erzeugt.
**Paket 5b ist nicht umgesetzt; `.githooks/pre-commit` bleibt unverändert.**
