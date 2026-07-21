import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

function writeSection(title) {
  console.log(`\n=== ${title} ===`);
}

console.log("Agent-Preflight");
console.log(`Repository: ${repoRoot}`);
console.log(`Bereich:    ${scope}`);

writeSection("Git");
console.log(
  `Branch: ${runGit("branch", "--show-current").trim() || "detached HEAD"}`,
);

const status = runGit("status", "--short");
if (!status) {
  console.log("Arbeitsbaum: sauber");
} else {
  console.log("Arbeitsbaum: vorhandene Aenderungen bewahren");
  for (const line of status.split(/\r?\n/)) console.log(`  ${line}`);
}

writeSection("Laufzeit");
if (["server", "frontend"].includes(scope)) {
  console.log(`Node: ${process.version}`);
  console.log(
    `server/node_modules: ${existsSync(join(repoRoot, "server", "node_modules")) ? "vorhanden" : "fehlt"}`,
  );
} else if (scope === "agent") {
  console.log(`Node: ${process.version}`);
  console.log(
    `agent/node_modules:  ${existsSync(join(repoRoot, "agent", "node_modules")) ? "vorhanden" : "fehlt"}`,
  );
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
