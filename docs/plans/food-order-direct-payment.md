# Essen: Direkte Zahlung pro Person

> Zielstand: 2026-08-21

Diese Datei beschreibt den implementierten Zielzustand. Die verbindliche Detailübergabe ist
[food-order-direct-payment-handover.md](food-order-direct-payment-handover.md); bei Abweichungen
gilt ausschließlich die Handover-Datei. Das interaktive Referenzbild ist
[food-order-direct-payment.html](../mockups/food-order-direct-payment.html).

## Ziel

Die Essen-Ansicht zeigt Sammelbestellungen übersichtlich nach Personen gruppiert. Bezahlt wird
pro Personenblock über genau einen PayPal-Button; anschließend bestätigt die Person den kompletten
Block mit „Bezahlt?“. Es gibt keinen alten Auswahlfluss, keine Zahlung an der Einzelposition und
keinen dreiwertigen Zahlungszustand.

## Verhalten

- Eine Positionszeile enthält Menge × Beschreibung, den vollständigen tip- und mengenbezogenen
  Betrag, Kopieren und – nur für eigene offene Positionen – Löschen. Sie enthält weder
  Bezahlmarkierung noch Zahlungs- oder Auswahlzustand.
- Der Personenblock zeigt „<n> Positionen“, bei fehlendem Preis zusätzlich „Preis fehlt“, die
  vollständige Personensumme, Kopieren, PayPal und die zweistufige Marke „Offen“/„Bezahlt“.
  „Bezahlt“ ist aus den Positionen abgeleitet und nennt die bestätigenden Personen.
- Die Marke ist für alle authentifizierten Mitglieder verfügbar und nur nach Finalisierung
  deaktiviert. Vorwärts und beim Aufheben gibt es keine Rückfrage. Das
  Löschen eines eigenen Blocks bestätigt die vollständige Positionsliste und bleibt bei bezahlten
  Positionen deaktiviert. Bei „Bezahlt“ werden sämtliche Positionszeilen der Person durchgestrichen.
- Der PayPal-Handoff öffnet synchron ein leeres neues Fenster, setzt popup.opener = null,
  lädt die Bestellung unmittelbar vor der Navigation frisch und bricht bei fehlender Bestellung,
  fehlenden Positionen, zwischenzeitlich bezahlten Positionen, fehlendem Link oder fehlenden
  Preisen ab. Nur bei einem einfachen `paypal.me`-Link wird der Betrag an die URL angehängt; andere
  Adressen öffnen unverändert. Danach öffnet sich sofort „Bezahlt?“ mit kopierbarer Summe und
  PayPal-Adresse; nur „Ja, bezahlt“ markiert alle Positionen dieses Blocks.
- Die Bestellübersicht ist aus Menü, Speisekarte und PayPal-Link erreichbar und für alle sichtbar.
  Sie enthält keine Namen und keinen Bezahlstatus.
- Die Übersicht zählt mengenbezogene Positionen, Personen und vollständig bezahlte Personen.
  Bei fehlenden Preisen zeigt sie den tatsächlich bepreisten Teilbetrag plus
  „Preise unvollständig“.
- Mehrere offene Bestellungen starten eingeklappt. Jede Karte nutzt dafür einen Geschwister-
  Toggle mit aria-expanded; ein direkter Such-/Push-Link klappt exakt seine Zielkarte auf.
  Eine einzelne offene Bestellung hat keine Karten-Einklappsteuerung. Gruppen behalten ihren
  eigenen, unabhängigen Expand-Zustand über Live-Renders hinweg. Verweist der Direktlink auf eine
  abgeschickte Bestellung, öffnet sich stattdessen die Historie mit der sichtbaren Zielbestellung.
- Ein stündlicher Job erinnert aktive Personen an unbezahlte Positionen, frühestens eine Stunde nach
  dem Abschicken. Er bündelt je Person/Event, sperrt einen erneuten Versand für eine rollierende
  Stunde dauerhaft in der Datenbank und erzeugt unter Home → Aktuell keinen zweiten Bestelleintrag.

## Betroffene Oberflächen und Infrastruktur

- server/public/js/views/foodOrders.js: Rendering, Gruppenaktionen, Bestätigungen, direkte
  Zahlung und vollständige Entfernung der alten Auswahl-Logik.
- server/public/js/icons.js: gefülltes lokales PayPal-Icon; alle übrigen Icons bleiben unverändert.
- server/public/css/style.css: Karten-, Gruppen-, Marker-, Zahlungs- und responsive
  Formularlayout gemäß Mockup.
- server/public/js/app.js, pushFeed.js, notificationBanner.js, sw.js: Deep-Link
  /#foodOrders/<id> und Zielkarten-Aufklappen bei Suche, Push-Banner, Mitteilungscenter und
  Service-Worker-Navigation.
- server/src/routes/foodOrders.ts: neue Push-Ziel-URL; bestehende paid-Metadaten bleiben
  kompatibel.
- server/src/foodOrderReminders.ts und server/src/db.ts: stündlicher Erinnerungsjob und Migration
  für den vom begrenzten Push-Verlauf unabhängigen Versandzustand.
- Tests und server/DESIGN_SYSTEM.md werden auf denselben Zielstand aktualisiert.

## Abnahmekriterien

- Keine Laufzeit-, CSS-, Design-System- oder Testreferenz auf den alten Auswahlfluss.
- Genau ein Zahlungsbutton je Personenblock; kein Einzelpositions-Button.
- Die drei Dialoge entsprechen dem Handover: PayPal-Bestätigung, Positionslöschung und vollständige
  Gruppenlöschung. Die Bezahlt-Marke schaltet in beide Richtungen direkt.
- Die erste Zahlungserinnerung kommt frühestens eine Stunde nach dem Abschicken; innerhalb der
  folgenden Stunde gibt es je Person/Event keine zweite und Home → Aktuell bleibt duplikatfrei.
- Freshness-Checks und synchroner Popup-Handoff aus PR #444 bleiben erhalten.
- npm --prefix server run lint, build, test, check:tokens und test:e2e sind grün.
