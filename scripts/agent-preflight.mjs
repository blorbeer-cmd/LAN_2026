import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSupportedNode,
  bootstrapWorktree,
} from "./worktree-bootstrap.mjs";

const scopes = new Set([
  "root",
  "server",
  "frontend",
  "agent",
  "docs",
  "infra",
]);

function usage(exitCode, message) {
  if (message) console.error(message);
  console.error(
    "Usage: node scripts/agent-preflight.mjs [--scope root|server|frontend|agent|docs|infra]",
  );
  process.exit(exitCode);
}

const args = process.argv.slice(2);
if (args.length === 1 && ["-h", "--help"].includes(args[0])) usage(0);
if (args.length !== 0 && (args.length !== 2 || args[0] !== "--scope")) {
  usage(2, "Unknown arguments.");
}

const scope = args.length === 0 ? "root" : args[1];
if (!scopes.has(scope)) usage(2, `Unknown scope: ${scope}`);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function runGit(...gitArgs) {
  const result = spawnSync("git", ["-C", repoRoot, ...gitArgs], {
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.error)
    throw new Error(`Git could not be started: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(
      `git ${gitArgs.join(" ")} failed: ${(result.stderr || "").trim()}`,
    );
  }

  return result.stdout.trimEnd();
}

function gitSucceeds(...gitArgs) {
  const result = spawnSync("git", ["-C", repoRoot, ...gitArgs], {
    encoding: "utf8",
    windowsHide: true,
  });
  return !result.error && result.status === 0;
}

function findWorktreeForBranch(branch) {
  const blocks = runGit("worktree", "list", "--porcelain").split(
    /(?:\r?\n){2,}/,
  );
  const branchRef = `branch refs/heads/${branch}`;

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    if (!lines.includes(branchRef)) continue;
    return lines
      .find((line) => line.startsWith("worktree "))
      ?.slice("worktree ".length);
  }

  return undefined;
}

function checkMergedPullRequests(branch) {
  if (process.env.AGENT_PREFLIGHT_DISABLE_GITHUB_CHECK === "1") {
    return { status: "skipped" };
  }

  const result = spawnSync(
    "gh",
    [
      "pr",
      "list",
      "--state",
      "all",
      "--head",
      branch,
      "--json",
      "number,title,url,state",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    },
  );

  if (result.error || result.status !== 0) {
    return {
      status: "unavailable",
      detail: result.error?.message || (result.stderr || "").trim(),
    };
  }

  try {
    const pullRequests = JSON.parse(result.stdout);
    return {
      status: "checked",
      mergedPullRequest: pullRequests.find(({ state }) => state === "MERGED"),
    };
  } catch {
    return {
      status: "unavailable",
      detail: "GitHub CLI returned invalid JSON.",
    };
  }
}

function writeSection(title) {
  console.log(`\n=== ${title} ===`);
}

console.log("Agent-Preflight");
console.log(`Repository: ${repoRoot}`);
console.log(`Bereich:    ${scope}`);

writeSection("Git");
const branch = runGit("branch", "--show-current").trim();
console.log(`Branch: ${branch || "detached HEAD"}`);
console.log(`Worktree: ${runGit("rev-parse", "--show-toplevel")}`);

const status = runGit("status", "--short");
if (!status) {
  console.log("Arbeitsbaum: sauber");
} else {
  console.log("Arbeitsbaum: vorhandene Aenderungen bewahren");
  for (const line of status.split(/\r?\n/)) console.log(`  ${line}`);
}

writeSection("Branch-Sicherheit");
let unsafeBranch = false;

if (!branch) {
  console.error(
    "SICHERHEITSSTOPP: Aenderungsauftraege duerfen nicht auf einem detached HEAD beginnen.",
  );
  unsafeBranch = true;
} else if (["main", "master"].includes(branch)) {
  console.error(
    `SICHERHEITSSTOPP: ${branch} ist nur Integrationsbasis. Fuer den Auftrag einen eigenen Branch und Worktree verwenden.`,
  );
  unsafeBranch = true;
} else {
  const mainWorktree = findWorktreeForBranch("main");
  if (!mainWorktree) {
    console.error(
      "SICHERHEITSSTOPP: main ist in keinem separaten Integrations-Worktree ausgecheckt.",
    );
    console.error(
      "Den Feature-Branch nicht im main-Worktree anlegen; main zuerst in einem eigenen Worktree wiederherstellen.",
    );
    unsafeBranch = true;
  } else {
    console.log(`main-Worktree: ${mainWorktree}`);
  }

  if (!gitSucceeds("rev-parse", "--verify", "--quiet", "origin/main")) {
    console.error(
      "SICHERHEITSSTOPP: origin/main fehlt. Vor dem Arbeitsstart origin/main aktualisieren.",
    );
    unsafeBranch = true;
  } else if (
    !gitSucceeds("merge-base", "--is-ancestor", "origin/main", "HEAD")
  ) {
    console.error(
      "SICHERHEITSSTOPP: Der Branch basiert nicht auf dem aktuellen origin/main.",
    );
    console.error(
      "Fuer den Auftrag einen neuen Branch und Worktree vom aktuellen origin/main anlegen.",
    );
    unsafeBranch = true;
  } else {
    console.log("Branch enthaelt den aktuellen Stand von origin/main.");
  }

  const githubCheck = checkMergedPullRequests(branch);
  if (githubCheck.status === "skipped") {
    console.log("GitHub-Pruefung: fuer den lokalen Skripttest deaktiviert");
  } else if (githubCheck.status === "unavailable") {
    console.warn(
      `WARNUNG: Bereits gemergte PRs konnten nicht geprueft werden${githubCheck.detail ? ` (${githubCheck.detail})` : ""}.`,
    );
    console.warn(
      "Vor Aenderungen manuell sicherstellen, dass dieser Branch noch nie gemergt wurde.",
    );
  } else if (githubCheck.mergedPullRequest) {
    const pullRequest = githubCheck.mergedPullRequest;
    console.error(
      `SICHERHEITSSTOPP: Branch ${branch} gehoert zum bereits gemergten PR #${pullRequest.number} (${pullRequest.title}).`,
    );
    console.error(
      "Diesen Branch nicht weiterverwenden. Fuer Folgearbeiten von aktuellem origin/main einen neuen Branch und Worktree anlegen.",
    );
    console.error(`PR: ${pullRequest.url}`);
    unsafeBranch = true;
  } else {
    console.log("Kein bereits gemergter PR fuer diesen Branch gefunden.");
  }
}

writeSection("Laufzeit");
let runtimeFailure = false;

try {
  assertSupportedNode();
} catch (error) {
  console.error(`SICHERHEITSSTOPP: ${error.message}`);
  runtimeFailure = true;
}

if (["server", "frontend"].includes(scope)) {
  console.log(`Node: ${process.version}`);
  if (unsafeBranch) {
    console.log(
      `server/node_modules: ${existsSync(join(repoRoot, "server", "node_modules")) ? "vorhanden" : "fehlt"}`,
    );
    console.log("Bootstrap: wegen Branch-Sicherheitsstopp uebersprungen");
  } else if (!runtimeFailure) {
    try {
      bootstrapWorktree({ repoRoot, scope });
    } catch (error) {
      console.error(
        `SICHERHEITSSTOPP: Worktree-Bootstrap fehlgeschlagen: ${error.message}`,
      );
      runtimeFailure = true;
    }
  }
} else if (scope === "agent") {
  console.log(`Node: ${process.version}`);
  if (unsafeBranch) {
    console.log(
      `agent/node_modules:  ${existsSync(join(repoRoot, "agent", "node_modules")) ? "vorhanden" : "fehlt"}`,
    );
    console.log("Bootstrap: wegen Branch-Sicherheitsstopp uebersprungen");
  } else if (!runtimeFailure) {
    try {
      bootstrapWorktree({ repoRoot, scope });
    } catch (error) {
      console.error(
        `SICHERHEITSSTOPP: Worktree-Bootstrap fehlgeschlagen: ${error.message}`,
      );
      runtimeFailure = true;
    }
  }
  console.log(
    `server/node_modules (fuer E2E): ${existsSync(join(repoRoot, "server", "node_modules")) ? "vorhanden" : "fehlt"}`,
  );
} else {
  console.log(
    "Fuer diesen Bereich ist keine weitere Laufzeitpruefung am Arbeitsstart noetig.",
  );
}

const requiredContext = {
  root: [],
  server: [
    "server/AGENTS.md",
    "server/DEVELOPMENT_GUIDELINES.md",
    "server/TESTING.md bei Implementierung oder Tests",
  ],
  frontend: [
    "server/AGENTS.md",
    "server/DEVELOPMENT_GUIDELINES.md",
    "server/TESTING.md",
    "server/public/AGENTS.md",
    "server/DESIGN_SYSTEM.md",
  ],
  agent: [
    "agent/AGENTS.md",
    "agent/DEVELOPMENT_GUIDELINES.md",
    "agent/README.md nur bei den dort genannten Funktionsbereichen",
  ],
  docs: [
    "docs/changelog/AGENTS.md nur bei Projekthistorie unter docs/changelog/",
  ],
  infra: [
    "server/OPERATIONS.md bei Deployment-, Logging-, Backup- oder Betriebsaenderungen",
  ],
};

writeSection("Pflichtkontext");
for (const file of [
  "AGENTS.md",
  "DEVELOPMENT_GUIDELINES.md",
  ...requiredContext[scope],
]) {
  console.log(`- ${file}`);
}

const standardChecks = {
  root: ["Pruefungen aus dem tatsaechlich betroffenen Bereich waehlen."],
  server: [
    "npm --prefix server run lint",
    "npm --prefix server run build",
    "npm --prefix server test",
    "E2E nur bei Frontend oder view-uebergreifenden Ablaeufen: npm --prefix server run test:e2e",
    "Tooling-/Format-Konfiguration: npm --prefix server run format:check",
  ],
  frontend: [
    "npm --prefix server run lint",
    "npm --prefix server run build",
    "npm --prefix server test",
    "npm --prefix server run check:tokens",
    "npm --prefix server run test:e2e",
  ],
  agent: [
    "npm --prefix agent run lint",
    "npm --prefix agent test",
    "E2E bei End-to-End- oder Serververtragsaenderungen: npm --prefix agent run test:e2e",
  ],
  docs: [
    "Keine pauschale Testsuite; Links, Metadaten und betroffene Dokumentstruktur gezielt pruefen.",
  ],
  infra: [
    "Keine pauschale Testsuite; betroffene Konfiguration statisch validieren und Betriebsrisiko nennen.",
    "Preflight: node --test scripts/agent-preflight.test.mjs",
  ],
};

writeSection("Standardpruefungen");
if (["server", "frontend"].includes(scope)) {
  console.log(
    "Nur Dokumentation: Links, Pfade und genannte Skripte manuell pruefen; die folgenden Codepruefungen entfallen.",
  );
}
for (const check of standardChecks[scope]) console.log(check);

writeSection("Naechster Schritt");
console.log(
  "Auftrag intern aus der Prosa konkretisieren und direkt die relevanten Pfade lesen.",
);

if (unsafeBranch) process.exit(3);
if (runtimeFailure) process.exit(4);
