import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const sourceScriptPath = resolve(scriptsDir, "agent-preflight.mjs");
const scopes = ["root", "server", "frontend", "agent", "docs", "infra"];
let fixtureRoot;
let fixtureWorktree;
let scriptPath;

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

before(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "agent-preflight-"));
  const fixtureScripts = join(fixtureRoot, "scripts");
  fixtureWorktree = join(fixtureRoot, "feature");
  mkdirSync(fixtureScripts);
  cpSync(sourceScriptPath, join(fixtureScripts, "agent-preflight.mjs"));
  writeFileSync(join(fixtureRoot, "README.md"), "preflight fixture\n");

  run("git", ["init", "--initial-branch=main"], fixtureRoot);
  run("git", ["config", "user.name", "Preflight Test"], fixtureRoot);
  run(
    "git",
    ["config", "user.email", "preflight@example.invalid"],
    fixtureRoot,
  );
  run("git", ["add", "."], fixtureRoot);
  run("git", ["commit", "-m", "Create fixture"], fixtureRoot);
  run("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], fixtureRoot);
  run(
    "git",
    ["worktree", "add", "-b", "test-safe", fixtureWorktree, "origin/main"],
    fixtureRoot,
  );
  scriptPath = join(fixtureWorktree, "scripts", "agent-preflight.mjs");
});

after(() => {
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
});

function runPreflight(args = [], cwd = fixtureWorktree) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      AGENT_PREFLIGHT_DISABLE_GITHUB_CHECK: "1",
    },
    windowsHide: true,
  });
}

function gitStatus() {
  const result = spawnSync(
    "git",
    ["-C", fixtureWorktree, "status", "--porcelain"],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  );
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
  const result = runPreflight([], tmpdir());
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

test("reports the worktree and branch safety check", () => {
  const result = runPreflight(["--scope", "root"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Worktree:/);
  assert.match(result.stdout, /=== Branch-Sicherheit ===/);
  assert.match(result.stdout, /main-Worktree:/);
  assert.match(result.stdout, /aktuellen Stand von origin\/main/);
  assert.match(
    result.stdout,
    /GitHub-Pruefung: fuer den lokalen Skripttest deaktiviert/,
  );
});

test("names the agent-pipeline test for infrastructure work", () => {
  const result = runPreflight(["--scope", "infra"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /node --test scripts\/agent-pipeline\.test\.mjs/);
});
