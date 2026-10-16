# Bereichstour

## 1. Status und Zweck

Status: umgesetzt. Manuell gestartete Bereichstouren erklären Funktionen und Folgeaktionen mit
kurzen Texten. Sie verändern keine Fachdaten und sind getrennt vom Erstlogin-Onboarding.

## 2. Quelle

- `public/js/areaTours.js`: `createAreaTours({ container, getContext })`, `sync`, `stop`, `dispose`.
- `public/js/areaTourCatalog.js`: Kerntexte, Kapitel und Rollen-/Featurefilter.
- `public/js/arcade/areaTours.js`: erst beim Arcade-Aufruf geladenes Spielekapitel.
- `public/js/areaTourProgress.js`: versionierter kontogebundener Gerätespeicher.
- `public/area-tour.html`, `public/js/areaTourDemo.js`: getrennte Demo-Instanz der normalen Ansichten.
- `public/js/areaTourDemoData.js`: lokale Datensätze und Schrittzuordnung, keine eigene UI-Nachbildung.
- `public/js/modal.js`: gemeinsames Modal mit unverändertem Fokusfang und Schließverhalten.

## 3. CSS-Eigentümerschaft

`style.css` besitzt die Titelzeile; `overlays.css` die benannte Tourdarstellung. Aufrufer ergänzen
keine eigene Controlgeometrie. Die Hilfeaktion verwendet den bestehenden `.icon-btn`.
`arcade.css` blendet den Hilfe-Button im Arcade-Vollbild zusammen mit dem visuell verborgenen
Spieltitel aus; außerhalb des Vollbilds gilt wieder die normale Titelzeile.

## 4. Varianten

Der Einstieg öffnet ein Standardmodal mit Tourstart und bei mehreren Kapiteln deren Auswahl.
Die laufende Tour verwendet `.area-tour-backdrop`: Dialog oben oder unten und eine separate
nichtinteraktive Hervorhebung. Das Tourmodal enthält nur Erklärung und Navigation.
Spiele, Vote, Umfragen, An-/Abreise, To-Do/Packliste, Essen und Match zeigen im Seitenbereich
eine beschriftete Demo der tatsächlichen Ansicht. Sie verwendet dieselben Renderer, Formulare
und Styles wie das Produkt. Normale Erstellen-/Detailaktionen öffnen dort die echten Dialoge;
Schrittwechsel wählen passende lokale Datenzustände (Stimmzettel, Ergebnis, Aufstellung usw.).
Andere Bereiche zeigen weiterhin ihre echten vorhandenen Elemente. Es gibt keine generischen
Ersatzkarten oder im Tourmodal nachgebauten Formulare.

Die Demo besitzt einen eigenen Modulkontext, Store und flüchtigen Browser-Speicher. Ihr Fetch
liefert nur bekannte lokale GET-Antworten; alle Schreibmethoden und unbekannten Ziele scheitern.
Zusätzlich verbietet ihre CSP sämtliche Verbindungen und Formularübermittlungen. Die Frame-
Sandbox erlaubt weder Formulare, Popups noch Navigation der Elternseite. Es werden keine
persönlichen Daten oder Zugangsdaten an die Demo übergeben. Entfernen des Frames verwirft
Datensätze, private View-Caches, Dialoge und Entwürfe gemeinsam.

## 5. Erlaubte Anpassungen

Ein Kapitel definiert stabile IDs, Klartexttitel, Text und einen Selektor vorhandener Elemente.
Optionale Rollen- und Featurebedingungen entfernen nicht verfügbare Kapitel und Schritte.
Aktionen der echten Anwendung werden weder aufgerufen noch durch programmatische Klicks
ausgelöst. Die Demo darf ausschließlich ihre eigenen lokalen Einstiegs- und Disclosure-
Controls betätigen; Schreibaktionen werden nicht zum Erzeugen von Zuständen benutzt.

## Geometrie

- `registry:area-tour-heading`: `.area-tour-heading` stellt Titel und Standard-Iconbutton mit
  `--space-1` Abstand nebeneinander. Die 32-px-Höhe und mindestens 44-px-Breite bleiben beim
  bestehenden Iconbutton. Der Titel darf umbrechen.
- `registry:area-tour-overlay` besitzt Frame, Demo-Seitencontainer/-Kennzeichnung, Erklärung
  und Aktionszeilen. Der Frame liegt viewportfest auf dem Rechteck des Seitenbereichs; seine
  Höhe endet oberhalb des Erklärdialogs. `frame.style.width`/`height` sind die registrierten
  Aufrufe für diese nichtinteraktive Geometrie. Innerhalb der Demo gelten die normalen Styles
  der jeweiligen Ansicht und Dialoge. Die Kennzeichnung nutzt `--space-2`/`--space-4`.
- `registry:area-tour-modal`: Der Schrittdialog behält maximal die Standardbreite von 480 px.
  Bei einer Demo steht er unten; der reservierte Bereich darüber enthält die echte Beispiel-
  Ansicht. Sonst entscheidet das Ziel über Platzierung oben oder unten.
  `--space-4` hält Abstand zu den Viewportkanten; die maximale Dialoghöhe berücksichtigt
  `--space-8`. Lange Inhalte scrollen im Dialog. Das Ziel entscheidet über Platzierung oben oder
  unten. Der Backdrop besitzt weder Unschärfe noch Einblendanimation, damit die Zielstelle sichtbar
  bleibt. Buttons behalten die Basisgeometrie; die Aktionen können als ganze Controls umbrechen.
- `registry:area-tour-target`: Der Ring ist nicht interaktiv und folgt der auf den Viewport
  begrenzten Zielgeometrie. Rahmen, Rundung und Schatten verwenden vorhandene Tokens. Der große
  Schatten-Spread dimmt außerhalb des Ziels wie beim Erstlogin-Onboarding.

## 7. Erreichbare Zustände

Tourauswahl, Kapitelstart, Fortsetzen, Neustart, Abschluss/Wiederholung, fehlendes Ziel,
Live-Rerender, abgebrochene Tour und Wechsel des Kontos, Events oder der Route.
Gesperrter beziehungsweise voller Browserspeicher verhindert die Tour nicht; dann bleibt der
Fortschritt gegebenenfalls nur für den aktuellen Durchlauf verfügbar.

## 8. Accessibility

Der Fragezeichen-Button hat den Namen „Bereich kennenlernen“, konkret mit dem jeweiligen
Bereichstitel, `aria-haspopup="dialog"` und den bestehenden sichtbaren Tastaturfokus.
Im Arcade-Vollbild ist er weder sichtbar noch fokussierbar. Nach Verlassen des Vollbilds
ist er wieder mit der Tastatur erreichbar.
Die Tour verwendet `openModal` für Escape, X, zyklischen Fokusfang und gestapelte Dialoge.
Ein Klick außerhalb schließt nur die Auswahl, niemals die laufende Tour. Diese endet bewusst
über „Tour beenden“, X, Escape oder den letzten Schritt. Der Demoframe ist inert und damit kein
zusätzlicher Tab-Stopp; die Erklärung bleibt mit Schrittzahl über die stabile Statusregion
zugänglich. Weiter wird erst nach erfolgreichem Aufbau der Szene freigegeben. Bei Ladefehlern
bleiben Beenden, Zurück und ein expliziter Neuversuch erreichbar.
Der Appinhalt und darunterliegende Dialoge werden während der Tour inert; ihre vorherigen
Zustände werden beim Ende wiederhergestellt. Die Erklärung und Schrittzahl werden angekündigt;
Weiter erhält nach jedem Schritt den Fokus. Der Ring ist für assistive Technik verborgen.
Scrollen zum Ziel benötigt keine Animation. Beim Ende werden die zuvor geschlossenen nativen
Details und die Scrollposition soweit noch vorhanden wiederhergestellt. Auch ein Ziel in einem
sichtbaren Summary öffnet dessen Details-Inhalt. Die Beispielszene verschwindet vollständig.
Native Formularwerte der echten Ansicht werden durch keine Beispielszene verändert.

## 9. Repräsentative Aufrufer

`app.js` verdrahtet alle Bereichstitel einschließlich der asynchron gerenderten Ansichten.
Info und Feedback melden ihren `tourKey` über die gemeinsame Modalschicht.
Die Darstellung gilt für Handy, Laptop und Desktop gleichermaßen.

## 10. Prüfungen und Abnahmebeispiele

`areaTourCatalog.test.js` prüft Bereichsabdeckung, maximal 30 Wörter je Schritt, stabile IDs sowie
Rollen-/Featurefilter. `areaTourProgress.test.js` prüft Kontotrennung, Wiederaufnahme, Abschluss,
veränderte Schrittlisten und blockierten/ungültigen Speicher.
Die bestehenden Shell-Browser-Fixtures prüfen Start ohne automatische Anzeige, Wiederaufnahme
nach Reload, schmale und breite Fenster, Fokusfang/-rückgabe, Hintergrundaktualisierung,
Beispielzustand und Info-Dialogstapel, Erstellen-Beispiele in Spiele/Vote/Umfragen/To-Do,
Match-Einstieg an h2, echte Dialoge/Einträge im Demoframe und unveränderte ursprüngliche
Anreise-Details samt ungespeichertem Formularentwurf. Der Browser versucht zusätzlich einen
Schreibzugriff in der Demo und erwartet 405 ohne Netzwerkrequest. Ein Backdrop-Klick muss
die Tour offen halten; Beenden entfernt die gesamte Demo. Tour-Schritte dürfen keine
mutierenden API-Aufrufe senden. Die Katalogtests prüfen konsistente Beispieldaten und das
Fail-closed-Verhalten der lokalen GET-Antworten.
Der bestehende Tetris-Vollbildfall prüft zusätzlich, dass die Hilfe im Vollbild keinen unsichtbaren
Fokus erhalten kann und danach wieder per Tastatur geöffnet werden kann.

## 11. Permanente Varianten und befristete Ausnahmen

Titelzeile, Tourmodal und Zielring sind permanente Varianten mit den oben genannten Registry-IDs.
Die Buttons verwenden die vorhandenen Controls. Es gibt keine befristete Ausnahme.
