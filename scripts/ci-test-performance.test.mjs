import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregatePerformance,
  aggregateSummary,
  assessDuration,
  collectHistoricalSuiteDurations,
  evaluateSuite,
  extractSuiteDurations,
  median,
} from "./ci-test-performance.mjs";
import { readFileSync } from "node:fs";

const config = {
  thresholdPercent: 20,
  minimumAbsoluteIncreaseSeconds: 30,
  baselineSamples: 5,
};

test("median handles odd and even samples without mutating input", () => {
  const values = [500, 100, 300, 200];
  assert.equal(median(values), 250);
  assert.deepEqual(values, [500, 100, 300, 200]);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([]), null);
});

test("regression needs both percentage and absolute increase", () => {
  assert.equal(
    assessDuration(121_000, 100_000, config).regressed,
    false,
    "absolute increase is too small",
  );
  assert.equal(
    assessDuration(140_000, 120_000, config).regressed,
    false,
    "percentage increase is too small",
  );
  assert.equal(assessDuration(160_000, 125_000, config).regressed, true);
});

test("suite evaluation waits for five main samples and then uses their median", () => {
  assert.equal(
    evaluateSuite(200_000, [100_000, 110_000], config).status,
    "collecting",
  );
  const result = evaluateSuite(
    160_000,
    [100_000, 110_000, 120_000, 130_000, 140_000, 999_000],
    config,
  );
  assert.equal(result.baselineMs, 120_000);
  assert.equal(result.status, "suspected");
});

test("only successful named jobs and steps contribute durations", () => {
  const suites = { core: { job: "Core", step: "Measured" } };
  const jobs = [
    {
      name: "Core",
      conclusion: "success",
      steps: [
        {
          name: "Measured",
          conclusion: "success",
          started_at: "2026-08-09T00:00:00Z",
          completed_at: "2026-08-09T00:01:30Z",
        },
      ],
    },
  ];
  assert.deepEqual(extractSuiteDurations(jobs, suites), { core: 90_000 });
  assert.deepEqual(
    extractSuiteDurations([{ ...jobs[0], conclusion: "failure" }], suites),
    {},
  );
});

test("partial Core selections never share the full-suite performance baseline", () => {
  const suites = {
    "e2e-core": {
      job: "Browser E2E Core",
      step: "Run measured Core E2E (all)",
    },
  };
  const job = {
    name: "Browser E2E Core",
    conclusion: "success",
    steps: [
      {
        name: "Run measured Core E2E (auth,checklist)",
        conclusion: "success",
        started_at: "2026-08-09T00:00:00Z",
        completed_at: "2026-08-09T00:00:20Z",
      },
    ],
  };
  assert.deepEqual(extractSuiteDurations([job], suites), {});
  job.steps[0].name = "Run measured Core E2E (all)";
  assert.deepEqual(extractSuiteDurations([job], suites), {
    "e2e-core": 20_000,
  });
});

test("history is fetched in bounded batches while retaining newest-run order", async () => {
  const suites = { core: { job: "Core", step: "Measured" } };
  const runs = [
    { id: "current" },
    { id: "newest" },
    { id: "middle" },
    { id: "oldest" },
  ];
  const durations = { newest: 90_000, middle: 80_000, oldest: 70_000 };
  const calls = [];
  let active = 0;
  let maximumActive = 0;
  const history = await collectHistoricalSuiteDurations({
    runs,
    currentRunId: "current",
    suites,
    baselineSamples: 2,
    batchSize: 2,
    loadJobs: async (runId) => {
      calls.push(runId);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) =>
        setTimeout(resolve, runId === "newest" ? 10 : 0),
      );
      active -= 1;
      return [
        {
          name: "Core",
          conclusion: "success",
          steps: [
            {
              name: "Measured",
              conclusion: "success",
              started_at: "2026-08-09T00:00:00.000Z",
              completed_at: new Date(
                Date.parse("2026-08-09T00:00:00.000Z") + durations[runId],
              ).toISOString(),
            },
          ],
        },
      ];
    },
  });

  assert.deepEqual(calls, ["newest", "middle"]);
  assert.equal(maximumActive, 2);
  assert.deepEqual(history, { core: [90_000, 80_000] });
});

test("history fetch rejects invalid batch sizes", async () => {
  for (const batchSize of [0, 7]) {
    await assert.rejects(
      collectHistoricalSuiteDurations({
        runs: [],
        currentRunId: "current",
        suites: {},
        baselineSamples: 1,
        batchSize,
        loadJobs: async () => [],
      }),
      /Ganzzahl zwischen 1 und 6/,
    );
  }
});

function detected(status = "ok") {
  return {
    results: {
      "e2e-core": {
        status,
        baselineMs: 100_000,
        currentMs: status === "suspected" ? 140_000 : 110_000,
        percent: status === "suspected" ? 40 : 10,
      },
    },
  };
}

function aggregate(overrides = {}) {
  return aggregatePerformance({
    applicable: true,
    changesResult: "success",
    detectorResult: "success",
    confirmationResult: "skipped",
    detection: detected(),
    confirmations: [],
    ...overrides,
  });
}

test("stable performance aggregate passes when measurement is not applicable", () => {
  const result = aggregate({ applicable: false, detection: null });
  assert.equal(result.passed, true);
  assert.equal(result.outcome, "not-applicable");
});

test("stable performance aggregate passes without a suspicion", () => {
  const result = aggregate();
  assert.equal(result.passed, true);
  assert.equal(result.outcome, "clear");
  assert.equal(result.rows[0].result, "clear");
});

test("stable performance aggregate passes when every suspicion clears", () => {
  const result = aggregate({
    detection: detected("suspected"),
    confirmationResult: "success",
    confirmations: [
      {
        suite: "e2e-core",
        baselineMs: 100_000,
        currentMs: 115_000,
        percent: 15,
        regressed: false,
      },
    ],
  });
  assert.equal(result.passed, true);
  assert.equal(result.outcome, "cleared-by-repeat");
  assert.match(aggregateSummary(result), /e2e-core.*100\.0 s.*140\.0 s.*\+40\.0 %.*115\.0 s/);
});

test("stable performance aggregate blocks a confirmed regression", () => {
  const result = aggregate({
    detection: detected("suspected"),
    confirmationResult: "failure",
    confirmations: [
      {
        suite: "e2e-core",
        baselineMs: 100_000,
        currentMs: 145_000,
        percent: 45,
        regressed: true,
      },
    ],
  });
  assert.equal(result.passed, false);
  assert.equal(result.outcome, "confirmed-regression");
  assert.match(aggregateSummary(result), /Verlangsamung bestätigt/);
});

test("stable performance aggregate fails closed on detector and confirmation errors", () => {
  for (const [name, overrides] of [
    ["classification", { changesResult: "failure" }],
    ["detector", { detectorResult: "failure", detection: null }],
    [
      "missing confirmation",
      { detection: detected("suspected"), confirmationResult: "skipped" },
    ],
    [
      "failed confirmation",
      {
        detection: detected("suspected"),
        confirmationResult: "failure",
        confirmations: [
          {
            suite: "e2e-core",
            baselineMs: 100_000,
            currentMs: 115_000,
            percent: 15,
            regressed: false,
          },
        ],
      },
    ],
  ]) {
    assert.equal(aggregate(overrides).passed, false, name);
  }
});

test("workflow keeps Test performance as the stable aggregate context", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/deploy.yml", import.meta.url),
    "utf8",
  ).replaceAll("\r\n", "\n");
  const detector = workflow.match(
    /\n  test-performance-detect:\n([\s\S]*?)\n  test-performance-confirm:/,
  )?.[1];
  const aggregateJob = workflow.match(
    /\n  test-performance:\n([\s\S]*?)\n  agent:/,
  )?.[1];
  assert.ok(detector, "performance detector job is missing");
  assert.match(detector, /^    name: Detect test performance$/m);
  assert.ok(aggregateJob, "stable performance aggregate job is missing");
  assert.match(aggregateJob, /^    name: Test performance$/m);
  assert.match(aggregateJob, /^    if: always\(\)$/m);
  assert.match(
    aggregateJob,
    /^    needs: \[changes, test-performance-detect, test-performance-confirm\]$/m,
  );
  assert.match(aggregateJob, /ci-test-performance\.mjs aggregate/);
});
