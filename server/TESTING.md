# Tests

Qualität wird über automatisierte Tests abgesichert. Bewusst schlank gehalten – kein schweres
Framework, sondern der **eingebaute Node-Test-Runner** (`node:test`) plus **supertest** für die API.

## Test-Arten

| Art | Womit | Was |
|-----|-------|-----|
| **Unit** | `node:test` + `assert` | Reine Logik ohne I/O: Zugangs-Guard (`auth.test.ts`), Live-Status-Ableitung (`liveStatus.test.ts`). |
| **Integration** | `node:test` + `supertest` | Echte HTTP-Requests gegen die Express-App (`src/test/*.test.ts`), gegen eine **In-Memory-DB**. |
| **E2E (Browser)** | Playwright | Folgt, sobald das Frontend steht: Klickpfade durch die Web-UI. |

## Ausführen

```bash
cd server
npm test          # baut Tests nach dist-test/ und führt alle *.test.ts aus
```

- Tests laufen gegen eine **In-Memory-SQLite** (`DB_FILE=:memory:`), berühren also nie echte Daten.
- Jede Test-Datei läuft in einem eigenen Prozess (Isolation durch den Node-Runner).

## Konventionen

- Testdateien heißen `*.test.ts` und liegen neben dem Code (Unit) bzw. unter `src/test/`
  (Integration).
- Der Produktions-Build (`npm run build`) schließt Testdateien aus – sie landen nie in `dist/`.
- `index.ts` startet den Server nur, wenn es direkt ausgeführt wird (`require.main === module`),
  damit Tests die App importieren können, ohne einen Port zu belegen.

## Vor jedem Commit

`npm run build` **und** `npm test` müssen grün sein (siehe Qualitäts-Checkliste in `CLAUDE.md`).
