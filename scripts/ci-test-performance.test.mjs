import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assessDuration,
  collectHistoricalSuiteDurations,
  evaluateSuite,
  extractSuiteDurations,
  median,
} from "./ci-test-performance.mjs";

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
