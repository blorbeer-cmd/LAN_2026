# Modal

## 1. Status und Zweck

Status der Basis, Präsentationsvarianten und `openModal`: `umgesetzt`.

Status von `confirmDialog` mit zyklischem Fokusfang und zuverlässiger Fokusrückgabe:
`umgesetzt` (Verhaltensänderung in Paket 3).

Modal ist die gemeinsame Dialogschicht für Formulare, Details und Bestätigungen. Sie unterstützt
bewusst gestapelte Dialoge. Sie ist kein Renderer für unbereinigtes Nutzer-HTML und definiert
keine allgemeine Wide-Variante.

## 2. Quelle

- Verhalten und Markup: `public/js/modal.js`
- Basisgeometrie und Suchpanelvarianten: `public/css/overlays.css`
- Etablierte zentrierte Profilfarb- und QR-Präsentation: `public/css/style.css`
- Öffentliche API:
  `openModal(title, bodyHtml, { onMount, onClose, confirmClose })`
- Rückgabe von `openModal`: `{ el, close }`
- Bestätigung:
  `confirmDialog(message, { title = 'Bestätigen', confirmText = 'OK',
  cancelText = 'Abbrechen', danger = false })`, Rückgabe `Promise<boolean>`

`openModal` behandelt `title` ausschließlich als Klartext: Überschrift und `aria-label` erhalten
den Rohtext über DOM-APIs. `bodyHtml` bleibt die bestehende Schnittstelle für vertrauenswürdiges,
vom Aufrufer erzeugtes HTML. `confirmDialog` escaped Titel, Nachricht und Aktionslabels.

## 3. CSS-Eigentümerschaft

`public/css/overlays.css` besitzt `.modal-backdrop`, `.modal`, Header/Body, mobile Bottom-Sheet-
und Desktopdialog-Geometrie sowie die beiden Suchpanelmodifier. `public/css/style.css` besitzt nur
die bereits etablierten, fachnahen Präsentationsmodifier für Profilfarbwähler und QR-Dialog.

Aufrufer DÜRFEN im `onMount` ausschließlich etablierte Backdropklassen ergänzen und Inhalte im
Modal-Body anordnen. Sie DÜRFEN Basisbreite, Layering, Fokusfang oder Schließverhalten nicht lokal
duplizieren.

## 4. Varianten

| Variante | Selektor/API | Status | Bedeutung |
|---|---|---|---|
| Standarddialog | `openModal`, `.modal` | umgesetzt | maximal 480 px breit |
| Bestätigung | `confirmDialog`, `role="alertdialog"` | umgesetzt | sichere Abbrechen-/Bestätigen-Entscheidung |
| Info-Suchpanel | `.info-board-modal .modal` | umgesetzt | etablierte Breite `--search-panel-width` |
| Globale Suche | `.global-search-modal .modal` | umgesetzt | etablierte Breite `--search-panel-width` und eigenes Innenlayout |
| Profilfarbwähler | `.profile-color-picker-modal` | umgesetzt | auch mobil zentrierter Dialog |
| QR-Dialog | `.invite-qr-backdrop` | umgesetzt | auch mobil zentrierter Dialog mit scanbarer QR-Fläche |
| Mobile Darstellung | Basisbackdrop unter `--bp-md` | umgesetzt | Bottom-Sheet |
| Breite Darstellung | Basisbackdrop ab `--bp-md` | umgesetzt | zentrierter Dialog |
| Gestapelte Dialoge | mehrere `.modal-backdrop` | umgesetzt | nur oberster Dialog verarbeitet Escape und Tab |

Eine allgemeine 640-px-Wide-Variante existiert nicht. Die 640-px-Breite gehört ausschließlich
den benannten Suchpanels über `--search-panel-width`.

## 5. Erlaubte Anpassungen

- Aufrufer DÜRFEN vertrauenswürdiges Body-Markup, `onMount`, `onClose` und eine synchrone
  `confirmClose`-Funktion übergeben.
- `onMount(backdrop, close)` DARF den Dialog verdrahten und eine etablierte Präsentationsklasse am
  Backdrop ergänzen.
- `confirmClose` DARF eine Warnnachricht zurückgeben. Eine leere Rückgabe schließt sofort; eine
  Nachricht öffnet den gestapelten „Änderungen verwerfen?“-Dialog.
- Der zurückgegebene `close()`-Aufruf ist für programmatisches Schließen nach erfolgreicher Aktion
  und umgeht `confirmClose` absichtlich.
- Aufrufer DÜRFEN Body-Inhalte fachlich layouten, aber keine neue globale Breitenvariante erfinden.

## 6. Komponenteneigene Invarianten

- `openModal` MUSS Titel als Klartext setzen; Markup, Handler und Attribute im Titel dürfen nie
  interpretiert werden. Body-Markup bleibt vertrauenswürdig und wird nicht automatisch escaped.
- Öffnen merkt das zuvor fokussierte Element, hängt den Backdrop an `document.body`, fokussiert das
  erste sichtbare Dialogcontrol und gibt beim Schließen den Fokus an das noch verbundene vorige
  Element zurück.
- Tab und Shift+Tab MÜSSEN im jeweils obersten Dialog zyklisch zwischen sichtbaren, nicht
  deaktivierten Controls laufen.
- Escape wirkt ausschließlich auf den obersten Backdrop. Ein geschlossener Bestätigungsdialog darf
  den darunterliegenden Dialog nicht schließen.
- Abbruch über X, Escape oder einen vollständigen Pointer-Klick auf den nackten Backdrop nutzt bei
  `openModal` `confirmClose`; programmatisches `close()` tut das nicht.
- Eine Interaktion, die im Dialog beginnt und außerhalb endet, DARF den Dialog nicht schließen.
- `confirmDialog` MUSS bei Abbrechen, Bestätigen, Escape und Backdrop-Abbruch genau einmal mit
  `false` beziehungsweise `true` auflösen und den Fokus zuverlässig zurückgeben.
- Bestätigungsdialoge besitzen keinen globalen Enter-Shortcut. Enter aktiviert nur das tatsächlich
  fokussierte native Control; anfänglich ist die sichere Abbrechen-Aktion fokussiert.
- Ein neuer Backdrop liegt über älteren Backdrops. Fokusfang und Escape des älteren Dialogs bleiben
  währenddessen inaktiv.

Registry-Bezüge für Dialogcontrols: `button`, `button-small`, `button-meaning`, `button-width` und
`icon-button` in [component-registry.mjs](../component-registry.mjs).

## 7. Erreichbare Zustände

- Standarddialog geöffnet und programmatisch geschlossen;
- Abbruch über X, Escape oder nackten Backdrop;
- unverändertes sowie verändertes Formular mit `confirmClose`;
- gestapelter Verwerfen-, Lösch- oder Schrittbestätigungsdialog;
- Bestätigung oder Abbruch im `confirmDialog`;
- Default-, Suchpanel-, Profilfarb- und QR-Präsentation;
- mobiler Bottom-Sheet- und zentrierter breiter Dialogzustand.

## 8. Accessibility

- `openModal` rendert `role="dialog"`, `aria-modal="true"` und den Klartexttitel als
  `aria-label`; `confirmDialog` verwendet `role="alertdialog"`.
- Die Schließen-Aktion besitzt den Namen „Schließen“. Bestätigen und Abbrechen sind echte Buttons
  mit sichtbaren deutschen Labels.
- Fokus wird beim Öffnen in den Dialog verschoben, zyklisch gefangen und beim Schließen
  zurückgegeben. Der Fokuspfad bleibt bei gestapelten Dialogen auf dem obersten Layer.
- Escape ist ein Abbruchpfad, kein Bestätigungsshortcut. Destruktive Bestätigung bleibt zusätzlich
  durch Text und Danger-Behandlung erkennbar.
- Der mobile Bottom-Sheet-Zustand und 200-Prozent-Reflow dürfen kein wesentliches Control
  abschneiden; der Dialogbody scrollt lokal.

## 9. Repräsentative Aufrufer

- Default und gestapelt: `public/js/views/events.js`, `foodOrders.js`, `eventPolls.js`
- Suchpanels: `public/js/views/infoBoard.js` und `public/js/searchPalette.js`
- Zentrierter Profilfarbwähler: `public/js/views/profile.js`
- Zentrierter QR-Dialog: `public/js/views/admin.js`
- Weitere Defaultdialoge: `public/js/views/gameCatalog.js`, `playerDetail.js` und
  `leaderboard.js`

## 10. Prüfungen und Abnahmebeispiele

- `src/test/e2e/flowsShell.fixture.ts` lädt `modal.js` im echten Browser und prüft den
  Klartexttitelvertrag, vertrauenswürdiges Body-Markup, Defaultbreite, Bottom-Sheet/Zentrierung,
  Tab/Shift+Tab, Escape, die Fokusrückgaben von `confirmDialog`, die Schließen-Aktion von
  `openModal` und einen gestapelten Dialog.
- Reale Flows prüfen zusätzlich Profil-, Spielkatalog-, globale Such-, Event- und
  Verwerfen-Dialoge.
- Bei 320×568 und 390×844 sitzt der Standarddialog als Bottom-Sheet ohne Seitenoverflow. Bei
  640 px und breiter ist er zentriert und höchstens 480 px breit; Suchpanels dürfen ausschließlich
  in ihren benannten Varianten bis `--search-panel-width` wachsen.
- Bei 512×384 und 720×450 bleiben Headeraktionen erreichbar und Overflow im Dialogbody statt auf
  der Seite.
- Ein verschachtelter Escape schließt genau einen Backdrop und fokussiert das auslösende Control im
  darunterliegenden Dialog.

## 11. Permanente Varianten und befristete Ausnahmen

Default, die beiden Suchpanelmodifier, Profilfarbwähler, QR-Dialog, Bestätigungsdialog und
Dialogstapel sind permanente Varianten mit den oben benannten Eigentümern und Gründen. Ihre
Controls verwenden die bestehenden Registry-IDs `button*` und `icon-button`; eine gesonderte
Controlgeometrie wird nicht eingeführt. Es gibt keine befristete Modal-Ausnahme.
