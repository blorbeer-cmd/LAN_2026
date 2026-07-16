# agent-dist/

This folder holds the prebuilt Windows agent binary that `/api/agent-download`
serves to players from their Profile page, bundled into a personalized ZIP
(exe + their own prefilled `agent.config.json` + an `install.bat` that copies
both into `%LOCALAPPDATA%` and registers Windows autostart).

It's intentionally **not** gitignored — the whole point is a one-click
download for participants, so the binary needs to actually be here, not
rebuilt on every deploy.

## Building `respawn-agent.exe`

Needs to be done once (or after every agent code change) on a machine with
normal internet access — `pkg` downloads a prebuilt Node runtime for the
target platform on first use, which this build environment's network policy
did not allow.

```bash
cd agent
npm install
npm install -D @yao-pkg/pkg
npx pkg src/index.js --targets node24-win-x64 --output ../server/agent-dist/respawn-agent.exe
```

Then commit the resulting `respawn-agent.exe` in this folder. Until it's
present, `/api/agent-download` responds with a clear 503 instead of a broken
download.
