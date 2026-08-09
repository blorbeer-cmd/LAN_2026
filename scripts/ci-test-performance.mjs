import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultConfigPath = path.resolve(
  scriptDir,
  "..",
  ".github",
  "test-performance.json",
);
const MAX_HISTORY_FETCH_BATCH_SIZE = 6;

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function assessDuration(currentMs, baselineMs, config) {
  const deltaMs = currentMs - baselineMs;
  const percent =
    baselineMs > 0 ? (deltaMs / baselineMs) * 100 : Number.POSITIVE_INFINITY;
  const minimumDeltaMs = config.minimumAbsoluteIncreaseSeconds * 1000;
  return {
    currentMs,
    baselineMs,
    deltaMs,
    percent,
    regressed: percent > config.thresholdPercent && deltaMs >= minimumDeltaMs,
  };
}

export function evaluateSuite(currentMs, historyMs, config) {
  if (historyMs.length < config.baselineSamples) {
    return {
      status: "collecting",
      currentMs,
      samples: historyMs.length,
      baselineMs: null,
    };
  }
  const sample = historyMs.slice(0, config.baselineSamples);
  const assessment = assessDuration(currentMs, median(sample), config);
  return {
    status: assessment.regressed ? "suspected" : "ok",
    samples: sample.length,
    ...assessment,
  };
}

export function extractSuiteDurations(jobs, suites) {
  const durations = {};
  for (const [suite, descriptor] of Object.entries(suites)) {
    const job = jobs.find(
      (candidate) =>
        candidate.name === descriptor.job && candidate.conclusion === "success",
    );
    const step = job?.steps?.find(
      (candidate) =>
        candidate.name === descriptor.step &&
        candidate.conclusion === "success",
    );
    if (!step?.started_at || !step?.completed_at) continue;
    const duration =
      Date.parse(step.completed_at) - Date.parse(step.started_at);
    if (Number.isFinite(duration) && duration >= 0) durations[suite] = duration;
  }
  return durations;
}

export async function collectHistoricalSuiteDurations({
  runs,
  currentRunId,
  suites,
  baselineSamples,
  loadJobs,
  batchSize = 6,
}) {
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MAX_HISTORY_FETCH_BATCH_SIZE
  )
    throw new Error(
      `historyFetchBatchSize muss eine Ganzzahl zwischen 1 und ${MAX_HISTORY_FETCH_BATCH_SIZE} sein.`,
    );
  const history = Object.fromEntries(
    Object.keys(suites).map((suite) => [suite, []]),
  );
  const candidates = runs.filter(
    (run) => String(run.id) !== String(currentRunId),
  );

  for (let index = 0; index < candidates.length; index += batchSize) {
    if (
      Object.values(history).every((values) => values.length >= baselineSamples)
    )
      break;
    const batch = candidates.slice(index, index + batchSize);
    const jobSets = await Promise.all(batch.map((run) => loadJobs(run.id)));
    for (const jobs of jobSets) {
      const durations = extractSuiteDurations(jobs, suites);
      for (const [suite, duration] of Object.entries(durations)) {
        if (history[suite].length < baselineSamples)
          history[suite].push(duration);
      }
    }
  }

  return history;
}

function loadConfig(configPath = defaultConfigPath) {
  return JSON.parse(readFileSync(configPath, "utf8"));
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

function formatDuration(milliseconds) {
  return `${(milliseconds / 1000).toFixed(1)} s`;
}

function formatPercent(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)} %`;
}

async function githubRequest(pathname, token, apiUrl) {
  const response = await fetch(`${apiUrl}${pathname}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok)
    throw new Error(
      `GitHub API ${response.status} for ${pathname}: ${await response.text()}`,
    );
  return response.json();
}

async function jobsForRun(repository, runId, token, apiUrl) {
  const payload = await githubRequest(
    `/repos/${repository}/actions/runs/${runId}/jobs?filter=latest&per_page=100`,
    token,
    apiUrl,
  );
  return payload.jobs ?? [];
}

export async function evaluateGithubRun({
  repository,
  workflow,
  runId,
  branch,
  token,
  apiUrl,
  config,
}) {
  const currentJobs = await jobsForRun(repository, runId, token, apiUrl);
  const current = extractSuiteDurations(currentJobs, config.suites);
  const runsPayload = await githubRequest(
    `/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/runs?branch=${encodeURIComponent(branch)}&status=success&per_page=${config.historyRuns}`,
    token,
    apiUrl,
  );
  const history = await collectHistoricalSuiteDurations({
    runs: runsPayload.workflow_runs ?? [],
    currentRunId: runId,
    suites: config.suites,
    baselineSamples: config.baselineSamples,
    batchSize: config.historyFetchBatchSize ?? 6,
    loadJobs: (historicalRunId) =>
      jobsForRun(repository, historicalRunId, token, apiUrl),
  });

  const results = {};
  for (const [suite, currentMs] of Object.entries(current)) {
    results[suite] = evaluateSuite(currentMs, history[suite], config);
  }
  return results;
}

function summaryFor(results, config) {
  const lines = [
    "## Testlauf-Performance",
    "",
    `Verdachtsschwelle: mehr als ${config.thresholdPercent} % und mindestens ${config.minimumAbsoluteIncreaseSeconds} s gegenüber dem Median der letzten ${config.baselineSamples} erfolgreichen \`main\`-Läufe.`,
    "",
    "| Suite | Aktuell | Basis | Änderung | Ergebnis |",
    "| --- | ---: | ---: | ---: | --- |",
  ];
  if (!Object.keys(results).length) {
    lines.push("| – | – | – | – | Keine gemessene Testsuite in diesem Lauf |");
  }
  for (const [suite, result] of Object.entries(results)) {
    if (result.status === "collecting") {
      lines.push(
        `| ${suite} | ${formatDuration(result.currentMs)} | ${result.samples}/${config.baselineSamples} Werte | – | Basis wird aufgebaut |`,
      );
      continue;
    }
    const label =
      result.status === "suspected"
        ? "Wiederholung erforderlich"
        : "Unauffällig";
    lines.push(
      `| ${suite} | ${formatDuration(result.currentMs)} | ${formatDuration(result.baselineMs)} | ${formatPercent(result.percent)} | ${label} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

async function evaluateGithubCommand(args) {
  const config = loadConfig(args.config);
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN fehlt.");
  const results = await evaluateGithubRun({
    repository: args.repository,
    workflow: args.workflow,
    runId: args["run-id"],
    branch: args.branch,
    token,
    apiUrl: process.env.GITHUB_API_URL ?? "https://api.github.com",
    config,
  });
  const suspicions = Object.entries(results)
    .filter(([, result]) => result.status === "suspected")
    .map(([suite, result]) => ({
      suite,
      baselineMs: Math.round(result.baselineMs),
    }));

  if (args.summary) appendFileSync(args.summary, summaryFor(results, config));
  if (args["github-output"]) {
    appendFileSync(
      args["github-output"],
      `has_suspicions=${suspicions.length > 0}\n`,
    );
    appendFileSync(
      args["github-output"],
      `suspicions=${JSON.stringify(suspicions)}\n`,
    );
  }
  console.log(summaryFor(results, config));
}

function confirmCommand(args) {
  const config = loadConfig(args.config);
  const currentMs = Number(args["current-ms"]);
  const baselineMs = Number(args["baseline-ms"]);
  if (
    !Number.isFinite(currentMs) ||
    !Number.isFinite(baselineMs) ||
    currentMs < 0 ||
    baselineMs <= 0
  ) {
    throw new Error("Bestätigungs-Laufzeiten sind ungültig.");
  }
  const result = assessDuration(currentMs, baselineMs, config);
  const message = `${args.suite}: Wiederholung ${formatDuration(currentMs)}, Basis ${formatDuration(baselineMs)}, Änderung ${formatPercent(result.percent)}`;
  if (result.regressed) {
    console.error(
      `::error title=Bestätigte Testlauf-Verlangsamung::${message}. Ursache untersuchen; Tests nicht lockern oder mit Timeouts kaschieren.`,
    );
    process.exitCode = 1;
  } else {
    console.log(`${message} – im Wiederholungslauf nicht bestätigt.`);
  }
}

async function main() {
  const command = process.argv[2];
  const args = parseArgs(process.argv.slice(3));
  if (command === "evaluate-github") await evaluateGithubCommand(args);
  else if (command === "confirm") confirmCommand(args);
  else throw new Error(`Unbekannter Befehl: ${command ?? ""}`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
