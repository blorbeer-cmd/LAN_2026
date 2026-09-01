# Server-Anweisungen

Gilt für alle Arbeiten unter `server/` zusätzlich zu den Root-Anweisungen.

## Pflichtlektüre

1. [`DEVELOPMENT_GUIDELINES.md`](DEVELOPMENT_GUIDELINES.md) vollständig lesen.
2. [`TESTING.md`](TESTING.md) lesen, wenn Implementierung, Tests oder Testkonfiguration betroffen
   sind.
3. [`OPERATIONS.md`](OPERATIONS.md) nur bei Deployment-, Logging-, Backup- oder Betriebsänderungen
   lesen.
4. Unter `public/` zusätzlich die dortige `AGENTS.md` beachten.

Quellcode und `src/db.ts` bleiben für aktuelle Implementierungs- und Schemadetails maßgeblich.

## Test-Qualität

Die Test-Design-Regeln in [`TESTING.md`](TESTING.md) sind verbindliche Akzeptanzkriterien, keine
Empfehlungen. Vor dem Anlegen neuer Tests zuerst die vorhandene Abdeckung im betroffenen Bereich
untersuchen und bestehende Tests bevorzugt erweitern, vereinfachen oder zusammenführen, wenn das
dieselbe Fehlererkennung mit weniger Komplexität erreicht. Eine Produktionscodeänderung allein
rechtfertigt keinen neuen Unit-, Integrations- oder E2E-Test.
