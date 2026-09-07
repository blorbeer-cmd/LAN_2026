import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";
import { assertSupportedNode, npmInvocation } from "./worktree-bootstrap.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const sourceScriptPath = resolve(scriptsDir, "agent-preflight.mjs");
const sourceBootstrapPath = resolve(scriptsDir, "worktree-bootstrap.mjs");
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
  cpSync(sourceBootstrapPath, join(fixtureScripts, "worktree-bootstrap.mjs"));
  writeFileSync(join(fixtureRoot, "README.md"), "preflight fixture\n");
  writeFileSync(join(fixtureRoot, ".gitignore"), "node_modules/\n");

  const dependencyName = "preflight-fixture-dependency";
  const dependencyRoot = join(fixtureRoot, "fixture-dependency");
  mkdirSync(dependencyRoot);
  writeFileSync(
    join(dependencyRoot, "package.json"),
    `${JSON.stringify(
      { name: dependencyName, version: "1.0.0", private: true },
      null,
      2,
    )}\n`,
  );

  for (const target of ["server", "agent"]) {
    const targetRoot = join(fixtureRoot, target);
    mkdirSync(targetRoot);
    const dependencySpec = { [dependencyName]: "file:../fixture-dependency" };
    writeFileSync(
      join(targetRoot, "package.json"),
      `${JSON.stringify(
        {
          name: `preflight-${target}`,
          version: "1.0.0",
          private: true,
          dependencies: dependencySpec,
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(join(targetRoot, "package-lock.json"), "");

    const invocation = npmInvocation([
      "install",
      "--package-lock-only",
      "--ignore-scripts",
      "--no-audit",
      "--prefix",
      targetRoot,
    ]);
    const lockResult = spawnSync(invocation.command, invocation.args, {
      cwd: fixtureRoot,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(lockResult.status, 0, lockResult.stderr);
  }

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

test("runs every supported scope without tracked worktree changes", () => {
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

test("bootstraps scoped dependencies once and reuses the lockfile stamp", () => {
  const modulesPath = join(fixtureWorktree, "server", "node_modules");
  rmSync(modulesPath, { recursive: true, force: true });

  const first = runPreflight(["--scope", "server"]);
  assert.equal(first.status, 0, first.stderr);
  assert.match(
    first.stdout,
    /server\/node_modules: npm ci \(node_modules fehlt\)/,
  );
  assert.match(first.stdout, /server\/node_modules: installiert/);

  const stampPath = join(modulesPath, ".respawn-worktree-bootstrap.json");
  const dependencyPackagePath = join(
    modulesPath,
    "preflight-fixture-dependency",
    "package.json",
  );
  assert.equal(existsSync(stampPath), true);
  assert.equal(existsSync(dependencyPackagePath), true);
  const firstStamp = readFileSync(stampPath, "utf8");

  const second = runPreflight(["--scope", "frontend"]);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /server\/node_modules: aktuell/);
  assert.equal(readFileSync(stampPath, "utf8"), firstStamp);
  assert.equal(existsSync(dependencyPackagePath), true);
});

test("refreshes dependencies when the runtime stamp does not match", () => {
  const targetRoot = join(fixtureWorktree, "agent");
  const modulesPath = join(targetRoot, "node_modules");
  const stampPath = join(modulesPath, ".respawn-worktree-bootstrap.json");
  const originalStamp = JSON.parse(readFileSync(stampPath, "utf8"));
  const mismatches = {
    nodeAbi: `${originalStamp.nodeAbi}-foreign`,
    platform: originalStamp.platform === "win32" ? "linux" : "win32",
    arch: originalStamp.arch === "x64" ? "arm64" : "x64",
  };

  for (const [field, value] of Object.entries(mismatches)) {
    writeFileSync(
      stampPath,
      `${JSON.stringify({ ...originalStamp, [field]: value }, null, 2)}\n`,
    );

    const result = runPreflight(["--scope", "agent"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /agent\/node_modules: npm ci \(Laufzeitplattform hat sich geaendert\)/,
    );

    const refreshedStamp = JSON.parse(readFileSync(stampPath, "utf8"));
    assert.equal(refreshedStamp.nodeAbi, process.versions.modules);
    assert.equal(refreshedStamp.platform, process.platform);
    assert.equal(refreshedStamp.arch, process.arch);
  }
});

test("refreshes dependencies after the scoped lockfile changes", () => {
  const lockfilePath = join(fixtureWorktree, "agent", "package-lock.json");
  const first = runPreflight(["--scope", "agent"]);
  assert.equal(first.status, 0, first.stderr);

  const lockfile = JSON.parse(readFileSync(lockfilePath, "utf8"));
  lockfile.version = "2.0.0";
  lockfile.packages[""].version = "2.0.0";
  writeFileSync(lockfilePath, `${JSON.stringify(lockfile, null, 2)}\n`);

  const second = runPreflight(["--scope", "agent"]);
  assert.equal(second.status, 0, second.stderr);
  assert.match(
    second.stdout,
    /agent\/node_modules: npm ci \(package-lock\.json hat sich geaendert\)/,
  );
  assert.match(second.stdout, /agent\/node_modules: installiert/);
});

test("the standalone bootstrap rejects unsupported scopes", () => {
  const bootstrapPath = join(
    fixtureWorktree,
    "scripts",
    "worktree-bootstrap.mjs",
  );
  const result = spawnSync(
    process.execPath,
    [bootstrapPath, "--scope", "unknown"],
    { cwd: fixtureWorktree, encoding: "utf8", windowsHide: true },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown scope: unknown/);
  assert.match(result.stderr, /Usage:/);
});

test("requires exactly the repository Node.js major version", () => {
  assert.doesNotThrow(() => assertSupportedNode("24.99.0"));
  assert.throws(
    () => assertSupportedNode("22.17.1"),
    /Node\.js 24 is required/,
  );
  assert.throws(() => assertSupportedNode("25.0.0"), /Node\.js 24 is required/);
});

test("does not bootstrap dependencies after a branch safety stop", () => {
  const mainModulesPath = join(fixtureRoot, "server", "node_modules");
  rmSync(mainModulesPath, { recursive: true, force: true });

  const result = spawnSync(
    process.execPath,
    [join(fixtureRoot, "scripts", "agent-preflight.mjs"), "--scope", "server"],
    {
      cwd: fixtureRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        AGENT_PREFLIGHT_DISABLE_GITHUB_CHECK: "1",
      },
      windowsHide: true,
    },
  );

  assert.equal(result.status, 3);
  assert.match(
    result.stderr,
    /SICHERHEITSSTOPP: main ist nur Integrationsbasis/,
  );
  assert.match(
    result.stdout,
    /Bootstrap: wegen Branch-Sicherheitsstopp uebersprungen/,
  );
  assert.equal(existsSync(mainModulesPath), false);
});

test("names the retained preflight test for infrastructure work", () => {
  const result = runPreflight(["--scope", "infra"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /node --test scripts\/agent-preflight\.test\.mjs/);
});
