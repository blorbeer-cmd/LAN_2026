# Frontend-Anweisungen

Gilt für alle Änderungen unter `server/public/` zusätzlich zu den Root- und Server-Anweisungen.

Vor Analyse oder Änderung [`../DESIGN_SYSTEM.md`](../DESIGN_SYSTEM.md) vollständig lesen. Seine
Tokens, Komponenten-, Icon-, Responsive- und Accessibility-Regeln sind verbindlich.

Nach `DESIGN_SYSTEM.md` im Komponentenindex [`../frontend-contracts/README.md`](../frontend-contracts/README.md)
anhand der berührten Helper, Klassen und CSS-Selektoren die betroffenen Verträge bestimmen und nur
diese vollständig lesen. Bei einer neuen Komponente oder Variante zusätzlich
[`../frontend-contracts/_contract-template.md`](../frontend-contracts/_contract-template.md) lesen
und Vertrag, Beispiel und Prüfungen im selben PR ergänzen.

Für Frontendänderungen aus `server/` mindestens ausführen:

- `npm run lint`
- `npm run build`
- `npm test`
- `npm run check:tokens`
- `npm run test:e2e`
