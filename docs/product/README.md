# Produktregeln

Diese Dokumentation ist die normative Quelle für produktbezogene Routen, Rollen, Geschäftsabläufe, sichtbare Fachtexte und Fachzustände. Sie ergänzt den [Designkern](../../server/DESIGN_SYSTEM.md) und die [Frontend-Komponentenverträge](../../server/frontend-contracts/README.md), ersetzt sie aber nicht.

## Zuständigkeiten

- [Designkern](../../server/DESIGN_SYSTEM.md): globale Prinzipien, Tokenquellen, kurze Komponenten-Kernregeln und Accessibility.
- [Frontend-Komponentenverträge](../../server/frontend-contracts/README.md): APIs, Innengeometrie, Interaktion, Komponenten-Accessibility und Varianten gemeinsamer Bausteine.
- Produktregeln: Routen, Rollen, Geschäftsabläufe, Fachtexte und Fachzustände der hier verlinkten Bereiche.

## Produktregeldateien

- [Navigation und Konto](navigation-and-account-rules.md)
- [Wettbewerb und Spiele](competition-and-game-rules.md)
- [Orga und Events](organisation-and-event-rules.md)
- [Medien und Dashboards](media-and-dashboard-rules.md)

UI-Arbeiten lesen nur die Produktregeldatei(en), die den betroffenen fachlichen Ablauf beschreiben.

## Migrationsnachweis

Die Zeilenbereiche beziehen sich auf `server/DESIGN_SYSTEM.md` vor dieser Paket-4-Migration. Die Zielanker sind stabile Markdown-Überschriften.

| Quellüberschrift und ursprünglicher Bereich | Zielanker |
|---|---|
| Core composition and content rules, Regeln 9–11 (291–322) | [Navigation, Rollen und Fachtexte](navigation-and-account-rules.md#navigation-rollen-und-fachtexte) |
| Components: Area tabs (343–363) | [Bereich-Tabs](navigation-and-account-rules.md#bereich-tabs) |
| Components: Mode / setting choice (379–387) | [Auswahlentscheidungen](competition-and-game-rules.md#auswahlentscheidungen) |
| Components: Notification center (423–431) | [Benachrichtigungszentrum](navigation-and-account-rules.md#benachrichtigungszentrum) |
| Components: Event dropdown (454–466) | [Eventauswahl](navigation-and-account-rules.md#eventauswahl) |
| Components: In-card footer actions (467–475) | [Kartenfooter-Aktionen](competition-and-game-rules.md#kartenfooter-aktionen) |
| Components: Seating status (481–487) | [Sitzstatus](organisation-and-event-rules.md#sitzstatus) |
| Components: Team formation, Player skill display, Game catalog (488–599) | [Teams, Skill und Spielkatalog](competition-and-game-rules.md#teams-skill-und-spielkatalog) |
| Components: Player profiles, Admin tools (600–678) | [Profile und Admin](navigation-and-account-rules.md#profile-und-admin) |
| Components: Kiosk dashboard (679–708) | [TV-Kiosk](media-and-dashboard-rules.md#tv-kiosk) |
| Components: Grouped page sections (709–744) | [Bereichsseiten und Mehr-Navigation](navigation-and-account-rules.md#bereichsseiten-und-mehr-navigation) |
| Components: Broadcasts, Food orders, Orga (745–1045) | [Durchsagen, Bestellungen und Orga](organisation-and-event-rules.md#durchsagen-bestellungen-und-orga) |
| Components: Hall of Fame and Info, Feedback (1046–1072) | [Hall of Fame, Info und Feedback](navigation-and-account-rules.md#hall-of-fame-info-und-feedback) |
| Components: Arrival carpools (1073–1083) | [An- und Abreise](organisation-and-event-rules.md#an--und-abreise) |
| Components: Arcade (1084–1191) | [Arcade](competition-and-game-rules.md#arcade) |
| Components: Jam sessions, Analytics (1192–1264) | [Jam-Sessions und Analytics](media-and-dashboard-rules.md#jam-sessions-und-analytics) |
| Components: Profile, Leaderboard, Home overview (1265–1320) | [Mein Profil, Auswertung und Home](navigation-and-account-rules.md#mein-profil-auswertung-und-home) |
| Components: Voting, Tournament overview (1321–1403) | [Vote und Turniere](competition-and-game-rules.md#vote-und-turniere) |
| Interaction and accessibility: first-login core tour (1452–1456) | [Erstlogin](navigation-and-account-rules.md#erstlogin) |

## Wortzahlparität

Für den verschobenen Regeltext werden sichtbare Wörter mit derselben Unicode-Wortgrenzen-Zählung (`[\p{L}\p{N}]+`) gezählt; Ziele von Markdown-Links zählen als reine Navigation nicht mit. Überschriften, Navigationslinks und die kurzen technischen Einleitungen dieser Dateien werden separat ausgewiesen.

| Korpus | Wörter |
|---|---:|
| Entfernte normative Quellbereiche | 14.405 |
| Hinzugefügter normativer Regeltext | 14.405 |
| Differenz | 0 |

Nicht im Regeltext gezählt sind 68 Wörter in Zielüberschriften, 93 Wörter in den vier technischen Einleitungen sowie 516 Wörter in diesem README (Einstieg, Links und Migrationsmatrix). Die Zählung wurde vor dem Abschluss mit derselben Methode auf allen 18 Quellbereichen und allen vier Zieldateien ausgeführt.
