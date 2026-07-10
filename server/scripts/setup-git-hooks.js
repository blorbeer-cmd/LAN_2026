#!/usr/bin/env node
// Runs on `npm install` (via the "prepare" lifecycle script) so every
// contributor gets the design-token pre-commit check automatically, without
// a manual setup step anyone could forget. Points git at the repo's tracked
// .githooks/ directory instead of the untracked (and per-clone) .git/hooks/.
//
// Silently does nothing if this isn't a git checkout at all (e.g. a
// packaged/deployed copy without a .git directory) — never breaks `npm
// install` for that case.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

try {
  const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  execSync('git config core.hooksPath .githooks', { cwd: repoRoot });

  const hookPath = path.join(repoRoot, '.githooks', 'pre-commit');
  if (fs.existsSync(hookPath)) {
    fs.chmodSync(hookPath, 0o755);
  }
} catch {
  // Not a git repository (or git isn't available) — nothing to wire up.
}
