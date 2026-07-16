# PR #171: Fix prepare hook in container build

- Datum des Merges: 2026-07-13
- Branch: `codex/docker-prepare-fix`
- Merge-Commit: [`2e92824`](https://github.com/blorbeer-cmd/Respawn/commit/2e92824818ec89944cef8165061ae1b41c4d8964)
- Pull Request: [#171](https://github.com/blorbeer-cmd/Respawn/pull/171)

## Changelog

- Der Docker-Builder kopiert `scripts/setup-git-hooks.js` jetzt vor `npm ci`.
- Das `prepare`-Lifecycle-Script kann damit wie vorgesehen außerhalb eines Git-Checkouts lautlos
  aussteigen.
- Der bei jedem Image-Build ausgegebene, durch `|| true` verdeckte
  `MODULE_NOT_FOUND`-Node.js-Stacktrace ist beseitigt.
- Der vollständige PR-Image-Build und der anschließende Produktionsdeploy wurden erfolgreich
  ausgeführt; der neue Container erreichte den Status `healthy`.
