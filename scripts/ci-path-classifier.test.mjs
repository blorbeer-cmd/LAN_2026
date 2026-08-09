import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { classifyChangedPaths } from "./ci-path-classifier.mjs";
import { VIEW_MANIFEST } from "../server/public/js/viewManifest.js";

const selected = (files, eventName) =>
  classifyChangedPaths(files, { eventName });

test("documentation-only changes select no runtime work", () => {
  assert.deepEqual(selected(["docs/testing.md", "README.md"]), {
    server: false,
    e2eCore: false,
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
    "server/public/js/arcade/views/challengeRush.js",
    "server/src/test/e2e/arcadeFlows.e2e.test.ts",
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

test("unknown E2E files fail closed into both partitions until the manifest is updated", () => {
  const result = selected(["server/src/test/e2e/newScenario.e2e.test.ts"]);
  assert.equal(result.e2eCore, true);
  assert.equal(result.e2eArcade, true);
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
  const arcadeViews = Object.entries(VIEW_MANIFEST).filter(([, entry]) => entry.area === "arcade");
  assert.ok(arcadeViews.length > 0, "the manifest must classify Arcade views");
  for (const [name, entry] of arcadeViews) {
    assert.match(entry.module, /^\.\/arcade\/views\//, name);
    assert.match(entry.exportName, /^render/, name);
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
    "server/public/js/viewManifest.js",
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

test("the workflow preserves the required aggregate Browser E2E check", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/deploy.yml", import.meta.url),
    "utf8",
  ).replaceAll("\r\n", "\n");
  const block = workflow.match(
    /\n  browser-e2e:\n([\s\S]*?)\n  test-performance-detect:/,
  )?.[1];

  assert.ok(block, "the Browser E2E aggregate job is missing");
  assert.match(block, /^    name: Browser E2E$/m);
  assert.match(block, /^    if: always\(\)$/m);
  assert.match(
    block,
    /^    needs: \[changes, e2e-core, e2e-arcade-smoke, e2e-arcade\]$/m,
  );
});
