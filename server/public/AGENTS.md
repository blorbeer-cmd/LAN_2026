# Frontend-Anweisungen

Gilt für alle Änderungen unter `server/public/` zusätzlich zu den Root- und Server-Anweisungen.

Vor Analyse oder Änderung [`../DESIGN_SYSTEM.md`](../DESIGN_SYSTEM.md) vollständig lesen. Seine
Tokens, Komponenten-, Icon-, Responsive- und Accessibility-Regeln sind verbindlich.

Für Frontendänderungen aus `server/` mindestens ausführen:

- `npm run lint`
- `npm run build`
- `npm test`
- `npm run check:tokens`
- `npm run test:e2e`
