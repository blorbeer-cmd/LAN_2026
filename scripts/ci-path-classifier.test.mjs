import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { classifyChangedPaths } from "./ci-path-classifier.mjs";

const selected = (files, eventName) =>
  classifyChangedPaths(files, { eventName });

test("documentation-only changes select no runtime work", () => {
  assert.deepEqual(selected(["docs/testing.md", "README.md"]), {
    server: false,
    e2eCore: false,
    e2eCoreScope: "none",
    e2eArcade: false,
    e2eArcadeSmoke: false,
    agent: false,
    image: false,
    deploy: false,
  });
});

test("Arcade-only implementation and E2E changes select only Arcade browser coverage", () => {
  for (const file of [
    "server/src/arcade/tetris.ts",
    "server/src/routes/arcade.ts",
    "server/public/js/views/challengeRush.js",
    "server/src/test/e2e/arcadeFlows.e2e.test.ts",
    "server/src/test/e2e/challengeRush.fixture.ts",
  ]) {
    const result = selected([file]);
    assert.equal(result.server, true, file);
    assert.equal(result.e2eCore, false, file);
    assert.equal(result.e2eArcade, true, file);
    assert.equal(result.e2eArcadeSmoke, false, file);
  }
  const arcadeStyles = selected(["server/public/css/arcade.css"]);
  assert.deepEqual(
    {
      core: arcadeStyles.e2eCore,
      arcade: arcadeStyles.e2eArcade,
      smoke: arcadeStyles.e2eArcadeSmoke,
    },
    { core: false, arcade: true, smoke: false },
  );
});

test("the kiosk remains a Core consumer and Arcade stylesheet versions stay synchronized", () => {
  const kiosk = readFileSync(new URL("../server/public/kiosk.html", import.meta.url), "utf8");
  const index = readFileSync(new URL("../server/public/index.html", import.meta.url), "utf8");
  const app = readFileSync(new URL("../server/public/js/app.js", import.meta.url), "utf8");
  const kioskSelection = selected(["server/public/kiosk.html"]);
  assert.equal(kioskSelection.e2eCore, true);
  assert.equal(kioskSelection.e2eArcade, false);
  assert.match(kiosk, /\/css\/arcade\.css\?v=(\d+)/);
  assert.doesNotMatch(index, /\/css\/arcade\.css/);
  const appVersion = app.match(/arcade\.css\?v=(\d+)/)?.[1];
  const kioskVersion = kiosk.match(/arcade\.css\?v=(\d+)/)?.[1];
  assert.ok(appVersion, "app.js must version the dynamic Arcade stylesheet");
  assert.equal(kioskVersion, appVersion);
  const views = app.match(/const VIEWS = \{([\s\S]*?)\n\};/)?.[1];
  const arcadeViews = app.match(/const ARCADE_VIEWS = new Set\(\[([\s\S]*?)\n\]\);/)?.[1];
  assert.ok(views && arcadeViews, "view registries must remain statically discoverable");
  for (const name of [...arcadeViews.matchAll(/'([^']+)'/g)].map((match) => match[1])) {
    assert.match(views, new RegExp(`\\b${name}: render`), name);
  }
});

test("known non-Arcade domains skip Arcade E2E", () => {
  const result = selected([
    "server/src/routes/votes.ts",
    "server/src/realtime.ts",
    "server/public/js/views/checklist.js",
  ]);
  assert.equal(result.e2eCore, true);
  assert.equal(result.e2eArcade, false);
  assert.equal(result.e2eCoreScope, "all");
});

test("isolated Core domains select only their owned browser fixtures", () => {
  const cases = [
    ["server/public/js/authGate.js", "auth"],
    ["server/src/routes/checklist.ts", "checklist"],
    ["server/src/test/e2e/eventInvitations.e2e.test.ts", "invitations"],
    ["server/src/routes/votes.ts", "flows"],
    ["server/src/test/e2e/flows.fixture.ts", "flows"],
  ];
  for (const [file, scope] of cases) {
    const result = selected([file]);
    assert.equal(result.e2eCore, true, file);
    assert.equal(result.e2eCoreScope, scope, file);
    assert.equal(result.e2eArcade, false, file);
  }

  assert.equal(
    selected(["server/public/js/authGate.js", "server/src/routes/checklist.ts"])
      .e2eCoreScope,
    "auth,checklist",
  );
});

test("auth changes retain Arcade auth smoke and auth-owned views merge Core coverage", () => {
  for (const file of [
    "server/public/js/authGate.js",
    "server/src/routes/auth.ts",
    "server/src/invites.ts",
  ]) {
    const result = selected([file]);
    assert.equal(result.e2eCoreScope, "auth", file);
    assert.equal(result.e2eArcade, false, file);
    assert.equal(result.e2eArcadeSmoke, true, file);
  }

  for (const file of [
    "server/public/js/views/admin.js",
    "server/public/js/views/profile.js",
  ]) {
    const result = selected([file]);
    assert.equal(result.e2eCoreScope, "auth,flows", file);
    assert.equal(result.e2eArcade, false, file);
    assert.equal(result.e2eArcadeSmoke, false, file);
  }
});

test("the shared socket auth guard selects Arcade smoke without the full Arcade suite", () => {
  assert.deepEqual(
    {
      core: selected(["server/src/realtime.ts"]).e2eCore,
      arcade: selected(["server/src/realtime.ts"]).e2eArcade,
      smoke: selected(["server/src/realtime.ts"]).e2eArcadeSmoke,
    },
    { core: true, arcade: false, smoke: true },
  );
  assert.deepEqual(
    {
      core: selected(["server/src/arcade/realtime.ts"]).e2eCore,
      arcade: selected(["server/src/arcade/realtime.ts"]).e2eArcade,
      smoke: selected(["server/src/arcade/realtime.ts"]).e2eArcadeSmoke,
    },
    { core: false, arcade: true, smoke: false },
  );
});

test("shared and unknown production paths use Core plus the bounded Arcade smoke suite", () => {
  for (const file of [
    "server/src/db.ts",
    "server/public/js/app.js",
    "server/public/css/style.css",
    "server/src/newSharedThing.ts",
  ]) {
    const result = selected([file]);
    assert.equal(result.e2eCore, true, file);
    assert.equal(result.e2eArcade, false, file);
    assert.equal(result.e2eArcadeSmoke, true, file);
  }
});

test("mixed Core and Arcade changes select both partitions", () => {
  const result = selected([
    "server/src/routes/votes.ts",
    "server/src/arcade/snake.ts",
  ]);
  assert.equal(result.e2eCore, true);
  assert.equal(result.e2eArcade, true);
  assert.equal(result.e2eArcadeSmoke, false);
});

test("server changes preserve server, agent, image and deploy gates", () => {
  const result = selected(["server/src/routes/votes.ts"]);
  assert.deepEqual(
    {
      server: result.server,
      agent: result.agent,
      image: result.image,
      deploy: result.deploy,
    },
    { server: true, agent: true, image: true, deploy: true },
  );
});

test("manual, scheduled, workflow and unknown root changes select all work", () => {
  for (const [files, eventName] of [
    [[], "workflow_dispatch"],
    [[], "schedule"],
    [[".github/workflows/deploy.yml"], "pull_request"],
    [["new-root-config.json"], "pull_request"],
  ]) {
    assert.deepEqual(selected(files, eventName), {
      server: true,
      e2eCore: true,
      e2eCoreScope: "all",
      e2eArcade: true,
      e2eArcadeSmoke: false,
      agent: true,
      image: true,
      deploy: true,
    });
  }
});

test("agent-only changes keep browser suites disabled", () => {
  const result = selected(["agent/src/index.js"]);
  assert.equal(result.agent, true);
  assert.equal(result.e2eCore, false);
  assert.equal(result.e2eArcade, false);
  assert.equal(result.e2eArcadeSmoke, false);
});

const readDeployWorkflow = () =>
  readFileSync(
    new URL("../.github/workflows/deploy.yml", import.meta.url),
    "utf8",
  ).replaceAll("\r\n", "\n");

test("the workflow preserves the required aggregate Browser E2E check", () => {
  const workflow = readDeployWorkflow();
  const block = workflow.match(
    /\n  browser-e2e:\n([\s\S]*?)\n  test-performance:/,
  )?.[1];

  assert.ok(block, "the Browser E2E aggregate job is missing");
  assert.match(block, /^    name: Browser E2E$/m);
  assert.match(block, /^    if: always\(\)$/m);
  assert.match(
    block,
    /^    needs: \[changes, e2e-core, e2e-arcade-smoke, e2e-arcade\]$/m,
  );
  assert.match(workflow, /^      e2e_core_scope: \$\{\{ steps\.filter\.outputs\.e2e_core_scope \}\}$/m);
  assert.match(
    workflow,
    /name: Run measured Core E2E \(\$\{\{ needs\.changes\.outputs\.e2e_core_scope \}\}\)/,
  );
});

// Regression guard: without a status check function GitHub adds an implicit
// success() that also trips on a *transitively* skipped dependency. That
// silently skipped deploy on every merge whose test-performance-confirm was
// skipped (the normal case), so images were published but never rolled out.
test("the deploy gate survives skipped upstream jobs", () => {
  const workflow = readDeployWorkflow();
  const block = workflow.match(/\n  deploy:\n([\s\S]*?)\n    steps:/)?.[1];

  assert.ok(block, "the deploy job is missing");
  const condition = block.match(/^    if: >-\n((?:      .*\n)+)/m)?.[1];
  assert.ok(condition, "the deploy job must gate itself with a folded if");
  assert.match(
    condition,
    /always\(\)/,
    "deploy must opt out of the implicit success() over its needs",
  );
  assert.match(
    condition,
    /needs\.publish\.result == 'success'/,
    "always() disables the implicit gate, so publish must be checked explicitly",
  );
  assert.match(
    condition,
    /github\.event_name == 'push' \|\| \(github\.event_name == 'workflow_dispatch' && inputs\.deploy\)/,
    "deploy stays limited to main pushes and explicit manual runs",
  );
  assert.match(block, /^    needs: publish$/m);
});
