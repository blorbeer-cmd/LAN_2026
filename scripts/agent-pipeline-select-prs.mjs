import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig, parseTaskContract } from "./agent-pipeline.mjs";

function hasReadinessStatus(pullRequest, statusContext) {
  return (pullRequest?.statusCheckRollup ?? []).some(
    (entry) =>
      entry?.__typename === "StatusContext" &&
      entry.context === statusContext,
  );
}

export function sweepReasons(pullRequest, config = loadConfig()) {
  const reasons = [];
  if (parseTaskContract(pullRequest?.body).participating) {
    reasons.push("activated task contract");
  }

  if (!hasReadinessStatus(pullRequest, config.statusContext)) {
    reasons.push("missing readiness status");
  }
  return reasons;
}

export function selectSweepPullRequests(pullRequests, config = loadConfig()) {
  if (!Array.isArray(pullRequests)) {
    throw new TypeError("Expected a JSON array of pull requests.");
  }
  return pullRequests
    .filter((pullRequest) => sweepReasons(pullRequest, config).length > 0)
    .map((pullRequest) => Number(pullRequest.number))
    .filter(Number.isInteger)
    .sort((left, right) => left - right);
}

const isCli =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isCli) {
  const input = readFileSync(0, "utf8");
  const pullRequests = JSON.parse(input);
  process.stdout.write(JSON.stringify(selectSweepPullRequests(pullRequests)));
}
