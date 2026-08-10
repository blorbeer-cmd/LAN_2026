import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ARCADE_E2E_FILES = new Set([
  "arcade.e2e.test.ts",
  "arcade.fixture.ts",
  "arcadeMultiplayer.e2e.test.ts",
  "arcadeScribbleViews.e2e.test.ts",
  "arcadeSmoke.e2e.test.ts",
  "arcadeStreamRenderer.e2e.test.ts",
  "authGateArcade.e2e.test.ts",
  "battleship.e2e.test.ts",
  "challengeRush.e2e.test.ts",
  "challengeRush.fixture.ts",
  "challengeRushLifecycle.e2e.test.ts",
  "arcadeFlows.e2e.test.ts",
  "arcadeFlows.fixture.ts",
  "snakeArenaViews.e2e.test.ts",
]);

const CORE_DOMAIN_ORDER = ["auth", "checklist", "invitations", "flows"];

const CORE_E2E_FILE_DOMAINS = new Map([
  ["access.e2e.test.ts", "auth"],
  ["authGate.e2e.test.ts", "auth"],
  ["checklist.e2e.test.ts", "checklist"],
  ["eventInvitations.e2e.test.ts", "invitations"],
  ["flows.fixture.ts", "flows"],
  ["flowsCompetition.e2e.test.ts", "flows"],
  ["flowsCommunity.e2e.test.ts", "flows"],
  ["flowsShell.e2e.test.ts", "flows"],
  ["phase5eIsolation.e2e.test.ts", "flows"],
]);

const ARCADE_VIEW_FILES = new Set([
  "arcade.js",
  "arcadeAdmin.js",
  "arcadeScribble.js",
  "arcadeUi.js",
  "arcadeWatch.js",
  "battleship.js",
  "blobby.js",
  "challengeRush.js",
  "pong.js",
  "snake.js",
  "tetris.js",
]);

const ARCADE_FRONTEND_FILES = new Set([
  "arcadeSound.js",
  "arcadeSound.test.js",
  "arcadeStreamRenderer.js",
  "arcadeStreamRenderer.test.js",
  "arcadeWatchFilter.js",
  "arcadeWatchFilter.test.js",
  "lobbyReady.js",
  "lobbyReady.test.js",
  "snakeArenaLegend.js",
  "snakeArenaLegend.test.js",
]);

const SHARED_FRONTEND_FILES = new Set([
  "admin.js",
  "api.js",
  "app.js",
  "authGate.js",
  "countdown.js",
  "data.js",
  "emptyState.js",
  "format.js",
  "groupContext.js",
  "icons.js",
  "infoTooltip.js",
  "modal.js",
  "socket.js",
  "state.js",
  "toast.js",
  "whoami.js",
]);

const SHARED_SERVER_FILES = new Set([
  "app.ts",
  "auth.ts",
  "communicationRecipients.ts",
  "config.ts",
  "db.ts",
  "eventParticipation.ts",
  "events.ts",
  "groupAuthorization.ts",
  "groupEventScope.ts",
  "groups.ts",
  "index.ts",
  "liveStatus.ts",
  "push.ts",
  "sessions.ts",
  "testUsers.ts",
  "validation.ts",
]);

const SHARED_ROUTE_FILES = new Set([
  "admin.ts",
  "auth.ts",
  "events.ts",
  "groups.ts",
  "players.ts",
  "push.ts",
  "quiz.ts",
]);

const ARCADE_TEST_PATTERN =
  /(?:^|\.)(?:arcade|battleship|blobby|challengeRush|pong|quiz|scribble|snake|tetris)/i;

function normalize(file) {
  return file.replaceAll("\\", "/").replace(/^\.\//, "");
}

function allSelected() {
  return {
    server: true,
    e2eCore: true,
    e2eCoreScope: "all",
    e2eArcade: true,
    e2eArcadeSmoke: false,
    agent: true,
    image: true,
    deploy: true,
  };
}

function emptySelection() {
  return {
    server: false,
    e2eCore: false,
    e2eCoreScope: "none",
    e2eArcade: false,
    e2eArcadeSmoke: false,
    agent: false,
    image: false,
    deploy: false,
  };
}

function mergeCoreScope(current, next) {
  if (!next || next === "none") return current;
  if (current === "all" || next === "all") return "all";
  const domains = new Set(
    [...(current === "none" ? [] : current.split(",")), ...next.split(",")],
  );
  return CORE_DOMAIN_ORDER.filter((domain) => domains.has(domain)).join(",");
}

function e2eImpactForServerPath(file) {
  if (file.startsWith("server/src/test/e2e/")) {
    const name = path.posix.basename(file);
    if (ARCADE_E2E_FILES.has(name))
      return { coreScope: "none", arcade: true, arcadeSmoke: false };
    if (CORE_E2E_FILE_DOMAINS.has(name))
      return { coreScope: CORE_E2E_FILE_DOMAINS.get(name), arcade: false, arcadeSmoke: false };
    return { coreScope: "all", arcade: true, arcadeSmoke: false };
  }

  if (file.startsWith("server/src/arcade/"))
    return { coreScope: "none", arcade: true, arcadeSmoke: false };
  if (file === "server/src/routes/arcade.ts")
    return { coreScope: "none", arcade: true, arcadeSmoke: false };
  if (file === "server/src/realtime.ts")
    return { coreScope: "all", arcade: false, arcadeSmoke: true };

  if (
    file === "server/public/js/authGate.js" ||
    file === "server/src/routes/auth.ts" ||
    file === "server/src/invites.ts"
  )
    return { coreScope: "auth", arcade: false, arcadeSmoke: true };

  if (
    file === "server/src/routes/checklist.ts" ||
    file === "server/public/js/views/checklist.js" ||
    file === "server/public/js/checklistDue.js" ||
    file === "server/src/checklistDefaults.ts"
  )
    return { coreScope: "checklist", arcade: false, arcadeSmoke: false };

  if (file.startsWith("server/public/js/views/")) {
    if (
      file === "server/public/js/views/admin.js" ||
      file === "server/public/js/views/profile.js"
    )
      return { coreScope: "auth,flows", arcade: false, arcadeSmoke: false };
    if (file === "server/public/js/views/games.js")
      return { coreScope: "all", arcade: false, arcadeSmoke: false };
    return ARCADE_VIEW_FILES.has(path.posix.basename(file))
      ? { coreScope: "none", arcade: true, arcadeSmoke: false }
      : { coreScope: "flows", arcade: false, arcadeSmoke: false };
  }

  if (file.startsWith("server/public/js/")) {
    const name = path.posix.basename(file);
    if (ARCADE_FRONTEND_FILES.has(name))
      return { coreScope: "none", arcade: true, arcadeSmoke: false };
    if (SHARED_FRONTEND_FILES.has(name))
      return { coreScope: "all", arcade: false, arcadeSmoke: true };
    return { coreScope: "flows", arcade: false, arcadeSmoke: false };
  }

  // Arcade presentation rules are loaded on demand by app.js. The kiosk loads
  // the same stylesheet statically, but its Arcade scenarios stay in the
  // dedicated Arcade partition. Keep direct CSS changes out of Core coverage.
  if (file === "server/public/css/arcade.css")
    return { coreScope: "none", arcade: true, arcadeSmoke: false };

  if (file.startsWith("server/public/"))
    return { coreScope: "all", arcade: false, arcadeSmoke: true };

  if (file.startsWith("server/src/routes/")) {
    return SHARED_ROUTE_FILES.has(path.posix.basename(file))
      ? { coreScope: "all", arcade: false, arcadeSmoke: true }
      : { coreScope: "flows", arcade: false, arcadeSmoke: false };
  }

  if (file.startsWith("server/src/test/") || file.endsWith(".test.ts")) {
    return ARCADE_TEST_PATTERN.test(path.posix.basename(file))
      ? { coreScope: "none", arcade: true, arcadeSmoke: false }
      : { coreScope: "all", arcade: false, arcadeSmoke: false };
  }

  if (file.startsWith("server/src/")) {
    const name = path.posix.basename(file);
    if (SHARED_SERVER_FILES.has(name))
      return { coreScope: "all", arcade: false, arcadeSmoke: true };
    // New or unclassified production modules fail closed until their impact
    // is deliberately added above.
    return { coreScope: "all", arcade: false, arcadeSmoke: true };
  }

  // Package, compiler, lint, Docker and test-infrastructure changes can alter
  // either suite and therefore deliberately select both.
  return { coreScope: "all", arcade: true, arcadeSmoke: false };
}

export function classifyChangedPaths(
  files,
  { eventName = "pull_request" } = {},
) {
  if (eventName === "workflow_dispatch" || eventName === "schedule")
    return allSelected();

  const selected = emptySelection();
  for (const rawFile of files) {
    const file = normalize(rawFile);
    if (!file) continue;

    if (file.startsWith("server/")) {
      selected.server = true;
      selected.agent = true;
      selected.image = true;
      selected.deploy = true;
      const impact = e2eImpactForServerPath(file);
      selected.e2eCoreScope = mergeCoreScope(selected.e2eCoreScope, impact.coreScope);
      selected.e2eCore = selected.e2eCoreScope !== "none";
      selected.e2eArcade ||= impact.arcade;
      selected.e2eArcadeSmoke ||= impact.arcadeSmoke;
      continue;
    }

    if (file.startsWith("agent/")) {
      selected.agent = true;
      continue;
    }

    if (file === "docker-compose.yml") {
      selected.image = true;
      selected.deploy = true;
      continue;
    }

    if (file.startsWith("docs/") || file.endsWith(".md")) continue;
    if (file === ".nvmrc" || file.startsWith(".github/workflows/"))
      return allSelected();

    // New root and infrastructure paths remain safety-sensitive.
    return allSelected();
  }
  if (selected.e2eArcade) selected.e2eArcadeSmoke = false;
  return selected;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, "");
    if (!key || argv[index + 1] === undefined)
      throw new Error(`Ungültiges Argument: ${argv[index] ?? ""}`);
    result[key] = argv[index + 1];
  }
  return result;
}

function resolveDiff(base, head) {
  const valid = (ref) =>
    ref &&
    !/^0+$/.test(ref) &&
    spawnSync("git", ["cat-file", "-e", `${ref}^{commit}`]).status === 0;
  let resolvedBase = base;
  if (!valid(resolvedBase)) {
    const fallback = spawnSync("git", ["rev-parse", `${head}^`], {
      encoding: "utf8",
    });
    resolvedBase = fallback.status === 0 ? fallback.stdout.trim() : "";
  }
  if (!valid(resolvedBase) || !valid(head)) return null;
  const diff = spawnSync(
    "git",
    ["diff", "--no-renames", "--name-only", "-z", resolvedBase, head],
    {
      encoding: "utf8",
    },
  );
  if (diff.status !== 0) return null;
  return diff.stdout.split("\0").filter(Boolean);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const eventName = args.event;
  let selected;
  if (eventName === "workflow_dispatch" || eventName === "schedule") {
    selected = allSelected();
  } else {
    const files = resolveDiff(args.base, args.head);
    if (!files) {
      console.error("Unable to resolve diff range; selecting all work.");
      selected = allSelected();
    } else {
      selected = classifyChangedPaths(files, { eventName });
    }
  }

  const lines = [
    `server=${selected.server}`,
    `e2e_core=${selected.e2eCore}`,
    `e2e_core_scope=${selected.e2eCoreScope}`,
    `e2e_arcade=${selected.e2eArcade}`,
    `e2e_arcade_smoke=${selected.e2eArcadeSmoke}`,
    `agent=${selected.agent}`,
    `image=${selected.image}`,
    `deploy=${selected.deploy}`,
  ];
  if (args["github-output"])
    appendFileSync(args["github-output"], `${lines.join("\n")}\n`);
  console.log(`Selected work: ${lines.join(" ")}`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
