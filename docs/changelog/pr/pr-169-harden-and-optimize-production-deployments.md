# PR #169: Harden and optimize production deployments

- Datum des Merges: 2026-07-13
- Branch: `codex/deploy-optimizations`
- Merge-Commit: [`e5f4da0`](https://github.com/blorbeer-cmd/Respawn/commit/e5f4da043166e0cd55cd4b72f687f2cedca49f17)
- Pull Request: [#169](https://github.com/blorbeer-cmd/Respawn/pull/169)

## Changelog

- GitHub-, Node- und Docker-Actions auf aktuelle Runtimes aktualisiert; wöchentliche
  Dependabot-Prüfung für Actions ergänzt.
- Runtime-Images werden bereits im Pull Request gebaut, aber erst von `main` veröffentlicht.
- Docker-BuildKit-Cache, Job-Timeouts und die Production-Environment-URL ergänzt.
- Reine Markdown- und `docs/`-Merges lösen keinen erneuten Produktionsdeploy aus.
- Das Runtime-Image besitzt einen authentifizierten Docker-Healthcheck; der Deploy wartet mit
  `docker compose up --wait` auf einen gesunden Node-Prozess.
- Compose-Konfiguration wird versioniert auf den Server übertragen und begrenzt App- sowie
  Tunnel-Logs in Größe und Anzahl.
- Bei Deployfehlern werden Containerstatus und die letzten 100 Logzeilen ausgegeben; anschließend
  wird automatisch das zuvor gepinnte Image wiederhergestellt.
- Stateful Browser-E2E-Flows für Profil und Admin-Seeding gegen Render-, Response- und
  Toast-Zeitfenster stabilisiert.
