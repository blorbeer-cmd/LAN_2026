import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const scriptPath = resolve(scriptsDir, "agent-preflight.mjs");
const scopes = ["root", "server", "frontend", "agent", "docs", "infra"];

function runPreflight(args = [], cwd = repoRoot) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
}

function gitStatus() {
  const result = spawnSync("git", ["-C", repoRoot, "status", "--porcelain"], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test("runs every supported scope without changing the worktree", () => {
  const before = gitStatus();

  for (const scope of scopes) {
    const result = runPreflight(["--scope", scope]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`Bereich:\\s+${scope}`));
  }

  assert.equal(gitStatus(), before);
});

test("uses root scope by default and works outside the repository", () => {
  const result = runPreflight([], dirname(repoRoot));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Bereich:\s+root/);
  assert.match(result.stdout, /AGENTS\.md/);
});

test("rejects unknown scopes", () => {
  const result = runPreflight(["--scope", "unknown"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown scope: unknown/);
  assert.match(result.stderr, /Usage:/);
});

test("explains the documentation-only verification path", () => {
  for (const scope of ["server", "frontend"]) {
    const result = runPreflight(["--scope", scope]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Nur Dokumentation:/);
    assert.match(result.stdout, /Codepruefungen entfallen/);
  }
});
