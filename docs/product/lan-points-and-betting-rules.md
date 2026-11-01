# LAN-Punkte und Sieger-Tipps

Diese Datei beschreibt die bisherige sichtbare LAN-Funktion. Das neue
[Zielkonzept](../KONZEPT-PUNKTE-WERTUNG.md) ersetzt ihre gemeinsame Wetten-/Orga-Wertung
schrittweise durch drei Kategorien und eine Gesamtwertung. Die [Journalbasis](points-journal.md)
ist bereits vorhanden; Kategorie-Rohwerte, Verlauf und Admin-Journal sind sichtbar. Weitere
Fachhandler, Wallet-Abrechnung und die endgültige Gesamtwertung folgen. Bestehende
Vorgabewerte und Grenzen der bisherigen Funktion entscheiden keine offenen Konzeptregeln.
Neue To-dos sammeln fest 3 getrennte Orga-Punkte ohne Punkteauswahl. Noch offene Altaufgaben
ohne Zusage wechseln ebenfalls zu dieser Regel. Nur bestehende historische Belohnungszusagen
verwenden weiterhin ihren alten Auszahlungspfad; neue Einzelzusagen sind gesperrt und beide
Vergütungswege schließen sich für dieselbe Aufgabe aus. Bereits erledigte
Aufgaben bekommen keinen rückwirkenden Punktwert. Laufende Events werden unterstützt.

Veröffentlichte LAN-Events sammeln Punkte automatisch im Hintergrund, unabhängig von der Anzeige
und vom Spiele-Tracking. Neue Wertungen sind zunächst ausgeblendet. Bereits eingerichtete Wertungen
bleiben bei einem Upgrade sichtbar; bisherige Konten, Regeln und Buchungen bleiben erhalten.

## Anzeige während des Events steuern

Admins und der gespeicherte Event-Ersteller steuern unter **Events & Gruppen → Event → LAN-Punkte**
mit **Für Teilnehmer anzeigen / ausblenden** die Anzeige für alle Teilnehmer. Der Ersteller darf dies
auch ohne Adminrolle oder eigene Teilnahme; dafür erhält er nur Event-Metadaten und den Schalter,
keine zusätzlichen Teilnehmer-, Konto- oder Finanzrechte. Regelwerk, Belohnungen, Punkteentzug und
Endwertung bleiben Adminaufgaben. Gleichzeitige Änderungen derselben Version werden abgewiesen.

Ausblenden entfernt Punktekonto, Verlauf, LAN-Ranglisten, Home-/Profil-Verweise, Wettbereiche an
Matches und Turnieren sowie Wettmitteilungen. Direkte Teilnehmer-API-Zugriffe sind ebenfalls gesperrt.
Die administrative Punkteverwaltung bleibt verfügbar. Konfigurierte Orga-Belohnungen werden weiterhin
automatisch gebucht; Startguthaben entsteht auch ohne Aufruf einer Punkteansicht. Aufgaben zeigen
Teilnehmern währenddessen keine Belohnungsbeträge oder Punkteplätze.

Neue Tipps, Tippänderungen und neue Tipprunden sind während des Ausblendens gesperrt. Vorhandene
Tipps, Reservierungen, Fristen, Abrechnungen und begründete Korrekturen bleiben erhalten und werden
weiter abgewickelt. Es gibt keinen Reset und kein zusätzliches Wettkontingent. Beim erneuten Anzeigen
steht sofort das aktuelle Konto mit dem vollständigen Verlauf bereit. Bereits ausgelieferte Web-Push-
Nachrichten lassen sich auf Geräten nicht zurückrufen; ihr Link zeigt währenddessen keine Punkteansicht.
Sichtbarkeit und bewusstes Festschreiben beziehungsweise Wiederöffnen der Endwertung sind getrennt.

## Konto und Rangliste

Die alte LAN-Kontosumme wird nur bei einer ausdrücklich gewählten konfigurierten LAN ohne
Spielfilter als Rangliste ausgegeben. Ein Spielfilter und jede eventübergreifende Rangliste
verwenden ausschließlich 4/3/2/1-Spielpunkte samt 5/3/1-Turnierboni; Grundstock, Orga und Wettnetto
werden dort nicht addiert. Ausgeblendete konfigurierte LANs liefern auch dort keine Punkte.
Hall of Fame und Event-Export verwenden bis zum [Umstellungspaket](../IMPLEMENTIERUNGSPLAN-PUNKTE-WERTUNG.md)
für eine konfigurierte LAN weiterhin deren altes Konto. Das ist noch keine Kategorie-/Gesamtwertung.


- Jeder zugesagte, aktive Teilnehmer erhält einmal den konfigurierten Grundstock, auch bei späterer
  Zusage. Austreten und erneutes Zusagen erzeugt keinen weiteren Grundstock. Testkonten zählen nicht.
- Spielsiege, Platzierungen, Spielzeit, Auslosungen und Ergebniseinträge erzeugen keine LAN-Punkte.
- Das persönliche Konto zeigt Gesamtpunkte, reservierte Einsätze, verfügbares Guthaben und gegebenenfalls
  eine Korrekturschuld. Der Verlauf enthält Zeitpunkt, Quelle, Betrag und Details jeder Buchung.
- Die Kurve zeigt immer die vollständige Kontohistorie. Suche und Quellenfilter verändern nur die Liste.
- Gleiche Punktestände teilen sich den Rang. Es gibt keinen Skill- oder Siege-Tiebreaker.
- Auch die Hall of Fame erhält geteilte Plätze und zählt jeden gemeinsamen Gesamtsieg für alle
  Erstplatzierten. Alphabetische Namensreihenfolge bestimmt ausschließlich die Darstellung.
- Die Verwaltung kann Preis und Sachpreisvergabe bei Gleichstand vor Beginn ankündigen; die
  Preisinfo erscheint am Punktekonto. Die tatsächliche Preisübergabe erfolgt durch die Orga.
- Ein Admin schreibt die Endwertung bewusst fest; offene oder laufende Tipprunden verhindern den
  Abschluss. Ein Ergebnis-Snapshot friert die Platzierung ein. Wiederöffnen benötigt eine Begründung;
  ein erneuter Abschluss erstellt eine weitere Version. Tracking-Stopp allein beendet die Wertung nicht.

## Orga-Punkte ohne Freigabeprozess

Ein Admin legt am offenen To-Do vor der ersten Übernahme Punkte pro Helfer und die Zahl belohnter
Helferplätze fest. Der Gesamtbetrag bindet das endliche Orga-Budget sofort. Die Zusage ist verbindlich.
Die ersten Übernahmen sichern die Plätze; weitere Helfer können ausdrücklich ohne Punkte mitmachen.
Eine Rückgabe vor Abschluss gibt den Helferplatz frei. Erledigen bucht die Belohnung automatisch,
einmalig und atomar mit dem Aufgabenstatus. Ist die Wertung bereits festgeschrieben, bleibt das
Erledigen möglich, erzeugt aber keine neue Gutschrift; Konto und Endwertungs-Snapshot bleiben
unverändert. Es gibt keine Warteschlange zur Punktefreigabe.

Admins können eine positive Gutschrift ganz oder teilweise mit Begründung entziehen. Die ursprüngliche
Buchung bleibt erhalten, der Entzug ist eine verknüpfte negative Buchung mit Admin und Zeitpunkt.
Das gilt ausdrücklich auch für die eigenen Gutschriften. Buchung und Admin-Protokoll werden
gemeinsam gespeichert; ein identischer Wiederholungsversuch erzeugt keine weiteren Einträge.
Der insgesamt entzogene Betrag überschreitet die ursprüngliche Gutschrift nicht. Ein identischer
Wiederholungsversuch ist wirkungslos; dieselbe Vorgangskennung mit anderem Inhalt wird abgewiesen.
Entzug, Aufgabenrücknahme und Kontolöschung füllen das bereits gebundene Orga-Budget nicht erneut auf.

Pilotwerte: 100 Startpunkte, 400 Orga-Punkte, maximal 10 Punkte pro Tipp, 30 Einsatzpunkte pro Tag und
sechs offizielle Tipprunden. Alle Werte stehen in der Verwaltung. **Tipprunden = 0** ermöglicht zuerst
eine LAN ausschließlich mit Orga-Punkten. Der Grundstock ist nach der ersten Regelkonfiguration oder
dem ersten Einblenden unveränderlich. Davor kann ein Admin den anfänglichen Standard von 100 Punkten
einmal konfigurieren; bereits gebuchte Grundstöcke werden durch eine nachvollziehbare Differenzbuchung
angepasst, verdiente Orga-Punkte bleiben erhalten.
Einsatzregeln sind nach Öffnung der ersten Runde fest. Gebundene Budgets können nicht unterschritten werden.

## Wetten am Match und Turnier

Admins öffnen eine offizielle Tipprunde direkt an einer noch ungespielten Zweier-Auslosung, einem
Turniermatch mit feststehenden Gegnern oder auf den Gesamtsieger eines noch nicht begonnenen Turniers.
Auslosen allein öffnet keine Runde. Jede Runde verbraucht dauerhaft einen Platz im LAN-Kontingent;
Löschen, Erstattung und neue Auslosungen setzen dieses nicht zurück.

Alle zugesagten Teilnehmer dürfen tippen, **einschließlich der Mitspieler und Ergebniseintrager**.
Eigenes Team, eigene Person und Gegner sind als Tipp erlaubt. Auch Turnierteilnehmer dürfen auf den
Turniersieger tippen. Ein Tipp pro Person und Runde, nur aus verfügbarem Guthaben. Änderungen und
Rücknahme sind bis zum Schließen möglich. Die Tagesgrenze gilt je LAN in Europe/Berlin und umfasst
offene sowie bereits gültig geschlossene Einsätze. Gewinne erhöhen die Tagesgrenze nicht.

Alle Teilnehmer erhalten beim Öffnen eine persönliche In-App-Mitteilung, auch die Mitspieler.
Bestehende Web-Push-Einwilligungen und Stummschaltungen gelten. Die Nachricht wird dedupliziert und
öffnet die richtige LAN und konkrete Runde. Beim Schließen wird sie als erledigt markiert; die
Historie bleibt erreichbar. Ein Server-Timer schließt fällige Runden auch ohne geöffneten Browser.

Tipps und Poolverteilung bleiben vor Tippschluss verborgen. Die eigene Auswahl und Reservierung sind
sichtbar. Mitspieler oder Admins schließen über **Spielstart / Tipps schließen** vor Spielbeginn;
alternativ greift die Frist. Trifft ein Ergebnis bei noch offenen Tipps ein, wird sicherheitshalber
erstattet. Respawn kann den tatsächlichen Spielstart außerhalb des Tools nicht erkennen.

Nach dem Schließen sind Tipps unveränderlich und der Topf, die Einsätze je Ausgang sowie Quoten
sichtbar. Match- und Turnierseiten zeigen zusätzlich den eigenen Einsatz und nach Abrechnung
Auszahlung und Nettogewinn bzw. Verlust. Das reguläre Eintragen des Ergebnisses rechnet automatisch ab.

## Nullsummige Auszahlung

Der Topf besteht ausschließlich aus den reservierten Einsätzen. Alle richtigen Tipps erhalten ihn
anteilig nach ihrem Einsatz. Beispiel: 10 auf Blau, 20 auf Blau und 15 auf Rot; bei Blau-Sieg werden
15 und 30 ausgezahlt. Netto entstehen +5, +10 und −15 Punkte. Kein Bonus und keine neuen Punkte.
Unteilbare Restpunkte werden nach dem größten Nachkomma-Rest, bei Gleichstand nach stabiler Tipp-ID
verteilt. Quote bedeutet Topf geteilt durch die Einsätze auf diesen Ausgang; sie enthält den Einsatz
und entsteht aus dem Pool, nicht aus selbst editierbaren Skillwerten.

Weniger als zwei Tippende oder nur ein getippter Ausgang führt beim Schließen zur Erstattung und
belastet das Tageskontingent nicht. Unentschieden, kein richtiger Tipp, Abbruch, entfernte Wettbewerbe
oder geänderte Aufstellungen führen ebenfalls zu Erstattung. Bereits gültig geschlossene Einsätze
behalten dann ihren Tagesverbrauch. Erstattungen ändern den Punktestand netto um null und erscheinen
trotzdem im Journal. Einsätze werden nicht doppelt abgezogen: während der Runde sind sie reserviert,
bei Abrechnung wird genau Auszahlung minus Einsatz gebucht.

## Ergebniskorrekturen

Normale Ergebnis-Editoren überschreiben keine ausgezahlte Runde still. Ein Admin kann auch bei eigenen
Einsätzen im bestehenden Ergebnisdialog mit Begründung und den angezeigten Abrechnungsversionen
korrigieren. Spielergebnis,
Gegenbuchung und neue Verteilung werden in einer gemeinsamen Datenbanktransaktion geschrieben.
Betroffene nachfolgende Begegnungen mit geänderten Teams werden erstattet. Eine wieder offene
Turniersiegerentscheidung behält ihren gesperrten ursprünglichen Pool bis zum neuen Endergebnis.
Unveränderte Abrechnungen bleiben erhalten. Parallele Korrekturen derselben Version werden abgewiesen.

Alternativ kann ein Admin eine Abrechnung vollständig mit Begründung stornieren, beispielsweise vor
dem Entfernen eines ungültigen Wettbewerbs. Das kehrt die ursprünglichen Nettotransfers um. Der Schutz
gilt auch beim Löschen des zugehörigen Katalogspiels samt dessen Wettbewerben. Es gibt keine neue Wette
auf denselben Wettbewerb. Ein bereits weiterverwendeter Gewinn kann durch Korrektur
zu negativem Guthaben führen. Fremde Wetten bleiben bestehen; neue Einsätze benötigen wieder Deckung.

## Grenzen und spätere Erweiterungen

Die Grenzen verhindern Punktefarmen durch beliebige Matchzahlen und begrenzen Transfers zwischen
Freunden. Abgesprochene Niederlagen und falsche Resultate können bei erlaubten Eigenwetten nicht
vollständig technisch ausgeschlossen werden. Kleine offizielle Pools, verborgene Tipps und das
nachvollziehbare Journal machen die Wertung überprüfbar; Admins können Missbrauch korrigieren.

Der physische Rage-Quit-Token bleibt eine spätere Erweiterung. Es gibt keinen automatischen
Skill-Handicap-Faktor und keine Echtgeldeinsätze. Personenbezogene Punkte und eigene Tipps sind im
Datenschutzexport enthalten; Kontolöschung entfernt die eigenen Buchungen und anonymisiert Tipps unter Erhalt der Poolbeträge sowie strukturierte
Ergebnis- und Teilnehmerkopien. Ein administrativer Betriebs- oder Produktivrollout ist gesondert.
