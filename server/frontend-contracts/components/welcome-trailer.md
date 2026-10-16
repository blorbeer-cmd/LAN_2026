# Willkommens-Trailer

## 1. Status und Zweck

Status: `umgesetzt`.

Der Willkommens-Trailer zeigt jedem Account einmal das LAN-Video: neuen Accounts direkt vor der
Einführungstour, bestehenden Accounts beim nächsten Öffnen der App. Er füllt die ganze Seite,
startet sofort und läuft notfalls stumm. Er ist kein allgemeiner Videoplayer und keine Variante
des Modals.

## 2. Quelle

- `public/js/onboarding.js`: `renderTrailer()`, `setTrailerState()`, `renderTrailerSound()`,
  `renderTrailerFullscreen()`, `startTrailer()`, `continueAfterTrailer()`.
- Server: `GET /api/me/onboarding/trailer`, `POST /api/me/onboarding/trailer/seen`,
  `GET /api/me/onboarding/trailer/video` und `/poster` in `src/routes/onboarding.ts`.

## 3. CSS-Eigentümerschaft

`public/css/overlays.css` besitzt alle Klassen `.onboarding-trailer*`. Andere Dateien setzen
keine Geometrie oder Farbe an diesen Klassen. Das Token `--media-letterbox` liegt in
`public/css/style.css`.

## 4. Varianten

| Selektor | Status | Bedeutung |
|---|---|---|
| `.onboarding-trailer-control` (registry:welcome-trailer-control) | umgesetzt | Durchscheinende Pille, zum Beispiel „Überspringen“ unten rechts |
| `.onboarding-trailer-sound` | umgesetzt | „Ton an“/„Ton aus“ unten links; mit `[data-muted]` im Akzentverlauf |
| `.onboarding-trailer-fullscreen` | umgesetzt | Quadratische Vollbild-Taste oben rechts, nur Icon |
| `.onboarding-trailer-start` (registry:welcome-trailer-start) | umgesetzt | Großer runder Abspielknopf, nur wenn der Browser jedes Autoplay blockiert; die Beschriftung steht darunter |

## 5. Erlaubte Anpassungen

Keine. Der Trailer hat genau einen Aufrufer; Platzierung und Reihenfolge der Tasten sind Teil
dieses Vertrags.

## 6. Komponenteneigene Invarianten

- Die Fläche MUSS die ganze Seite füllen (`position: fixed; inset: 0`) und das Video mit
  `object-fit: contain` auf `--media-letterbox` zeigen.
- Tasten MÜSSEN `--tap-target-size` hoch sein, `--radius-full` und `--font-size-md` verwenden und
  einen durchscheinenden Hintergrund aus `--bg` mit Weichzeichner haben, damit das Bild frei bleibt.
- Ist der Ton aus, MUSS „Ton an“ den Akzentverlauf mit `--shadow-glow-accent` tragen. Es ist die
  einzige farbige Taste; das Icon ist als Mediensteuerung bewusst erlaubt.
- Abstände zum Rand MÜSSEN die Safe Area (`env(safe-area-inset-*)`) berücksichtigen.
- Der große Abspielknopf ist rund und `--tap-target-size` × 1,75 groß; das Video wird darunter auf
  45 % abgedunkelt. Der Fokus verwendet den globalen `:focus-visible`-Ring, der der Rundung folgt.
- Echtes Browser-Vollbild DARF nur nach einer frischen Interaktion angefordert werden (direkt nach
  Registrierung oder Login, sonst über die Vollbild-Taste). Ohne Unterstützung ist die Taste
  ausgeblendet; die Seite bleibt bildschirmfüllend.

## 7. Erreichbare Zustände

| `data-state` | Sichtbar |
|---|---|
| `loading` | Statuspille „Lädt …“ |
| `playing` | Ton-Taste („Ton an“ mit `[data-muted]` oder „Ton aus“), Fortschrittsbalken |
| `idle` | Großer Knopf „Trailer abspielen“, abgedunkeltes Video |
| `error` | Statuspille „Video konnte nicht geladen werden“ |

„Überspringen“ ist in jedem Zustand sichtbar. Am Videoende schließt der Trailer selbst.

## 8. Accessibility

- Die Fläche ist ein `role="dialog"` mit `aria-modal="true"` und Namen; beim Öffnen erhält sie
  selbst den Fokus. Tab bleibt im Dialog, Escape überspringt.
- Das Video ist `aria-hidden`; alle Aktionen haben sichtbare Texte oder einen `aria-label`.
- Verschwindet die fokussierte Taste, wandert der Fokus auf „Überspringen“.
- Statusmeldungen laufen über `role="status"`.

## 9. Repräsentative Aufrufer

`maybeStartOnboarding()` in `public/js/onboarding.js`, geprüft bei 390 px (Handy hochkant) und
1280 px (Laptop).

## 10. Prüfungen und Abnahmebeispiele

- `src/test/e2e/authGate.e2e.test.ts`: Nach der Registrierung erscheint der Trailer, „Überspringen“
  speichert „gesehen“, nach dem Neuladen folgt die Tour ohne Trailer.
- `src/test/api.onboarding.test.ts`: Verfügbarkeit, Range-Auslieferung, paralleles „gesehen“.
- Sichtprüfung bei 390 und 1280 px: keine horizontale Scrollleiste, Tasten innerhalb der Safe Area.

## 11. Permanente Varianten und befristete Ausnahmen

- registry:welcome-trailer-control-glyph: Icons in den Tasten haben die Größe `--space-5`, passend
  zur Schrift `--font-size-md`.
- registry:welcome-trailer-start-glyph: Das Play-Icon im großen Knopf hat `--space-7` und ist um
  `--space-1` optisch nach rechts versetzt.

Befristete Ausnahmen: keine.
