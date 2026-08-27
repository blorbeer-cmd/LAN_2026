# Browser-UI/UX-Audit: offene Priorität-3-Punkte

Stand: 2026-08-27
Branch: `codex/ui-ux-audit-open-p3`
Basis: `origin/main` bei `bf8e5f34b3d33183694dcff67fe519a326e5cfeb`

## Verifizierte Ausgangslage

- PR #498, #499, #500 und #501 sind gemergt; ihre Merge-Commits sind in der Ausgangsbasis
  enthalten.
- Die Teilnahmezustände aus #498 bleiben unverändert. Zusage, spätere Absage, erneute Zusage und
  vorhandene Sperrgründe werden weiterhin durch die bestehende API bestimmt.
- #499 und #501 gelten als abgeschlossen und werden nicht erneut umgesetzt.

## Entscheidungen

### Einladungs- und Eventwechsel

Nach einer Zusage zeigt das Profil den eindeutigen Handoff „Event öffnen“. Die Aktion aktiviert das
angenommene Event über den bestehenden zentralen Eventwechsel und öffnet Home in diesem
Arbeitsbereich. Der serverseitig bereits aufgelöste Einladungstyp bleibt als gelesene Historie im
Mitteilungszentrum erhalten; er verschwindet aus dem offenen Highlight. „Aktuell“ und die
Einladungsliste werden durch denselben gemeinsamen Refresh aktualisiert.

Nach erfolgreicher Eventanlage öffnet die bestehende Teilnehmerverwaltung unmittelbar. Dadurch
entsteht kein zweiter Einladungsdialog und keine neue Berechtigungslogik.

### Lokale Browserrouten

Die Hauptnavigation bleibt die einzige Autorität für Rollen- und Featuregrenzen. Ergänzt wird nur
serialisierbarer UI-Zustand:

- `#tournaments/new`
- `#tournaments/<id>`
- `#arcade/<spiel>`

Ein zentraler Router schreibt diesen Zustand in URL und `history.state`. Normale lokale Navigation
nutzt echte History-Einträge; direkte Deep Links verwenden beim sichtbaren Zurück einen sicheren
Fallback zur jeweiligen Übersicht. Der Turnierentwurf bleibt beim Zurück/Vorwärts im Modulzustand
erhalten. Ein erfolgreich angelegtes Turnier ersetzt den Entwurfs-Eintrag durch die Detailroute.

### Informationshierarchie

- Admin zeigt Werkzeuge vor Diagnoseinhalten. Die Bereitschaft zeigt den Gesamtstatus direkt und
  legt Einzelprüfungen unter „Prüfdetails“ ab. Alle bisherigen Aktionen und Inhalte bleiben
  vorhanden.
- Vote zeigt ausgewählte Spiele und Suche vor dem vollständigen, einklappbaren Katalog.
- Profil hält Identität und dringende Eventaktionen offen; Sicherheit, Agent,
  Benachrichtigungen und Monitore sind klar benannte, einklappbare Gruppen.
- Arcade stellt das aktive Spiel voran. Der Launcher wird dann zum kompakten „Spiel wechseln“.

Die einklappbaren Gruppen verwenden stabile `data-*`-Selektoren. Ihr Offen-Zustand bleibt über den
zentralen `viewRenderState`-Mechanismus bei lokalen, API- und Socket-bedingten Re-Renders erhalten,
ohne einen zweiten langlebigen View-Zustand über Navigation oder Identitätswechsel hinweg
einzuführen.

### Begriffstrennung

Die organisatorische Route `eventPolls` heißt sichtbar „Umfragen“ beziehungsweise
„Event-Umfrage“. Navigation, Suche, Überschriften, Hilfen, Dialoge und Tests verwenden diesen
Begriff. Route, API, Datenbankfelder und gespeicherte Daten werden nicht umbenannt. „Vote“ und die
spielbezogene „Abstimmung“ bleiben unverändert.

## Bewusst nicht umgesetzt

- Die Games-Liste bleibt unverändert: Das Audit belegte bei ihren vorhandenen Filtern keinen
  zusätzlichen Browsernutzen. Eine Änderung wäre damit unnötiges Regressionsrisiko.
- Keine Migration des Modal-Helfers auf natives `<dialog>`; dies war bereits begründet aus dem
  Auditumfang ausgeschlossen.
- Keine kosmetischen Dateisplits, kein Framework-Wechsel und keine neue Produktionsabhängigkeit.
- Keine Umbenennung bestehender Routen, API-Verträge oder gespeicherter Poll-/Vote-Daten.

## Regressionen

Unit-Tests decken Hash-Parsing und Roundtrips ab. Browser-E2E deckt Einladung/Handoff,
Mitteilungsstatus, Teilnehmer-Handoff nach Eventanlage, Turnier-History und Reload sowie
Arcade-History, Deep Link, Reload und sichtbaren Zurückweg ab. Browser-Regressionen sichern zudem
den Offen-Zustand der neuen Profil-, Admin- und Vote-Gruppen bei lokalen, API- und
Socket-bedingten Re-Renders. Bestehende Eventteilnahme-, Vote-, Admin-, Profil- und Arcade-Suiten
bleiben Teil der Abnahme.
