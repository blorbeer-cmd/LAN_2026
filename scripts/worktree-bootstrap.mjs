import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_NODE_MAJOR = 24;

const stampFileName = ".respawn-worktree-bootstrap.json";
const supportedScopes = new Set(["all", "server", "frontend", "agent"]);

function usage(exitCode, message) {
  if (message) console.error(message);
  console.error(
    "Usage: node scripts/worktree-bootstrap.mjs [--scope all|server|frontend|agent] [--force]",
  );
  process.exit(exitCode);
}

export function assertSupportedNode(version = process.versions.node) {
  const major = Number.parseInt(version.split(".")[0], 10);
  if (major !== REQUIRED_NODE_MAJOR) {
    throw new Error(
      `Node.js ${REQUIRED_NODE_MAJOR} is required, but ${version} is running. Install/select Node.js ${REQUIRED_NODE_MAJOR} once and retry.`,
    );
  }
}

export function dependencyTargetsForScope(scope) {
  if (!supportedScopes.has(scope)) {
    throw new Error(`Unknown bootstrap scope: ${scope}`);
  }

  if (scope === "all") return ["server", "agent"];
  if (scope === "frontend") return ["server"];
  return [scope];
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readStamp(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function installReason({ force, modulesPath, stamp, lockfileSha256 }) {
  if (force) return "ausdruecklich angefordert";
  if (!existsSync(modulesPath)) return "node_modules fehlt";
  if (!stamp) return "Bootstrap-Nachweis fehlt";
  if (stamp.nodeMajor !== REQUIRED_NODE_MAJOR) {
    return "Node-Hauptversion hat sich geaendert";
  }
  if (
    stamp.nodeAbi !== process.versions.modules ||
    stamp.platform !== process.platform ||
    stamp.arch !== process.arch
  ) {
    return "Laufzeitplattform hat sich geaendert";
  }
  if (stamp.lockfileSha256 !== lockfileSha256) {
    return "package-lock.json hat sich geaendert";
  }
  return undefined;
}

function writeStamp(path, contents) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(contents, null, 2)}\n`);
  renameSync(temporaryPath, path);
}

function npmInvocation(args) {
  const configuredCli = process.env.npm_execpath;
  if (configuredCli && existsSync(configuredCli)) {
    return { command: process.execPath, args: [configuredCli, ...args] };
  }

  if (process.platform === "win32") {
    const pathEntries = (process.env.PATH ?? "").split(";").filter(Boolean);
    for (const pathEntry of [dirname(process.execPath), ...pathEntries]) {
      const npmCli = join(
        pathEntry,
        "node_modules",
        "npm",
        "bin",
        "npm-cli.js",
      );
      if (existsSync(npmCli)) {
        return { command: process.execPath, args: [npmCli, ...args] };
      }
    }

    throw new Error("npm-cli.js was not found on PATH.");
  }

  return { command: "npm", args };
}

function installTarget({ repoRoot, target, force, log }) {
  const targetRoot = join(repoRoot, target);
  const packagePath = join(targetRoot, "package.json");
  const lockfilePath = join(targetRoot, "package-lock.json");
  const modulesPath = join(targetRoot, "node_modules");
  const stampPath = join(modulesPath, stampFileName);

  if (!existsSync(packagePath) || !existsSync(lockfilePath)) {
    throw new Error(
      `${target} cannot be bootstrapped because package.json or package-lock.json is missing.`,
    );
  }

  const lockfileSha256 = sha256(lockfilePath);
  const reason = installReason({
    force,
    modulesPath,
    stamp: readStamp(stampPath),
    lockfileSha256,
  });

  if (!reason) {
    log(`${target}/node_modules: aktuell`);
    return { target, installed: false };
  }

  log(`${target}/node_modules: npm ci (${reason})`);
  const invocation = npmInvocation(["ci", "--prefix", targetRoot]);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: repoRoot,
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.error) {
    throw new Error(
      `npm ci for ${target} could not start: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `npm ci for ${target} failed with exit code ${result.status}.`,
    );
  }

  mkdirSync(modulesPath, { recursive: true });
  writeStamp(stampPath, {
    schemaVersion: 1,
    lockfileSha256,
    nodeMajor: REQUIRED_NODE_MAJOR,
    nodeAbi: process.versions.modules,
    platform: process.platform,
    arch: process.arch,
  });
  log(`${target}/node_modules: installiert`);
  return { target, installed: true };
}

export function bootstrapWorktree({
  repoRoot,
  scope = "all",
  force = false,
  log = console.log,
} = {}) {
  assertSupportedNode();
  const resolvedRoot = resolve(
    repoRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  );

  return dependencyTargetsForScope(scope).map((target) =>
    installTarget({
      repoRoot: resolvedRoot,
      target,
      force,
      log,
    }),
  );
}

function parseArguments(args) {
  let scope = "all";
  let force = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (["-h", "--help"].includes(argument)) usage(0);
    if (argument === "--force") {
      force = true;
      continue;
    }
    if (argument === "--scope" && args[index + 1]) {
      scope = args[index + 1];
      index += 1;
      continue;
    }
    usage(2, `Unknown argument: ${argument}`);
  }

  if (!supportedScopes.has(scope)) usage(2, `Unknown scope: ${scope}`);
  return { scope, force };
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath)) {
  const options = parseArguments(process.argv.slice(2));
  const repoRoot = resolve(dirname(scriptPath), "..");
  console.log("Worktree-Bootstrap");
  console.log(`Repository: ${repoRoot}`);
  console.log(`Node:       ${process.version}`);

  try {
    bootstrapWorktree({ repoRoot, ...options });
  } catch (error) {
    console.error(`FEHLER: ${error.message}`);
    process.exit(1);
  }
}
