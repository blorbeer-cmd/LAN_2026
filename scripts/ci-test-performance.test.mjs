import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assessDuration,
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
