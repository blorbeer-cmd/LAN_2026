# Bereichstour

## 1. Status und Zweck

Status: umgesetzt. Manuell gestartete Bereichstouren erklären Funktionen und Folgeaktionen mit
kurzen Texten. Sie verändern keine Fachdaten und sind getrennt vom Erstlogin-Onboarding.

## 2. Quelle

- `public/js/areaTours.js`: `createAreaTours({ container, getContext })`, `sync`, `stop`, `dispose`.
- `public/js/areaTourCatalog.js`: Kerntexte, Kapitel und Rollen-/Featurefilter.
- `public/js/arcade/areaTours.js`: erst beim Arcade-Aufruf geladenes Spielekapitel.
- `public/js/areaTourProgress.js`: versionierter kontogebundener Gerätespeicher.
- `public/js/modal.js`: gemeinsames Modal mit unverändertem Fokusfang und Schließverhalten.

## 3. CSS-Eigentümerschaft

`style.css` besitzt die Titelzeile; `overlays.css` die benannte Tourdarstellung. Aufrufer ergänzen
keine eigene Controlgeometrie. Die Hilfeaktion verwendet den bestehenden `.icon-btn`.

## 4. Varianten

Der Einstieg öffnet ein Standardmodal mit Tourstart und bei mehreren Kapiteln deren Auswahl.
Die laufende Tour verwendet `.area-tour-backdrop`: Dialog oben oder unten und eine separate
nichtinteraktive Hervorhebung. Fehlt das benötigte Element, nennt der Dialog ausdrücklich ein
Beispiel und dimmt den gesamten Hintergrund. Schritte ohne Ziel erklären den Bereich allgemein.

## 5. Erlaubte Anpassungen

Ein Kapitel definiert stabile IDs, Klartexttitel, Text und einen Selektor vorhandener Elemente.
Optionale Rollen- und Featurebedingungen entfernen nicht verfügbare Kapitel und Schritte.
Produktaktionen werden weder aufgerufen noch durch programmatische Klicks ausgelöst.

## Geometrie

- `registry:area-tour-heading`: `.area-tour-heading` stellt Titel und Standard-Iconbutton mit
  `--space-1` Abstand nebeneinander. Die 32-px-Höhe und mindestens 44-px-Breite bleiben beim
  bestehenden Iconbutton. Der Titel darf umbrechen.
- `registry:area-tour-overlay` besitzt die nichtinteraktiven Container und Aktionszeilen.
- `registry:area-tour-modal`: Der Schrittdialog behält die Standardmodalbreite von maximal
  480 px. `--space-4` hält Abstand zu den Viewportkanten; seine maximale Höhe berücksichtigt
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
Die Tour verwendet `openModal` für Escape, X, Backdrop, zyklischen Fokusfang und gestapelte
Dialoge. Der Appinhalt und darunterliegende Dialoge werden während der Tour inert; ihre vorherigen
Zustände werden beim Ende wiederhergestellt. Die Erklärung und Schrittzahl werden angekündigt;
Weiter erhält nach jedem Schritt den Fokus. Der Ring ist für assistive Technik verborgen.
Scrollen zum Ziel benötigt keine Animation. Beim Ende werden die zuvor geschlossenen nativen
Details und die Scrollposition soweit noch vorhanden wiederhergestellt.

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
Beispielzustand und Info-Dialogstapel. Tour-Schritte dürfen keine mutierenden API-Aufrufe senden.

## 11. Permanente Varianten und befristete Ausnahmen

Titelzeile, Tourmodal und Zielring sind permanente Varianten mit den oben genannten Registry-IDs.
Die Buttons verwenden die vorhandenen Controls. Es gibt keine befristete Ausnahme.
