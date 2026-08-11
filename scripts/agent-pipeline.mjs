import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(
  repoRoot,
  ".github",
  "agent-pipeline",
  "config.json",
);

export function loadConfig(path = configPath) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const requiredContractKeys = new Set([
  "task-id",
  "implementer",
  "base-branch",
  "base-sha",
  "head-branch",
  "scope",
  "ui-change",
  "max-ci-fix-rounds",
  "max-review-rounds",
]);

const optionalContractKeys = new Set(["codex-thread-id"]);
const contractKeys = new Set([...requiredContractKeys, ...optionalContractKeys]);

export function parseTaskContract(body) {
  const text = typeof body === "string" ? body : "";
  const match = text.match(
    /(?:<!--\s*)?agent-pipeline:task\s*\r?\n([\s\S]*?)\r?\n\s*agent-pipeline:end(?:\s*-->)?/,
  );

  if (!match) return { participating: false, contract: null, errors: [] };

  const values = {};
  const errors = [];
  for (const originalLine of match[1].split(/\r?\n/)) {
    const line = originalLine.trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 1) {
      errors.push(`Malformed task-contract line: ${line}`);
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!contractKeys.has(key)) {
      errors.push(`Unknown task-contract key: ${key}`);
      continue;
    }
    if (Object.hasOwn(values, key)) {
      errors.push(`Duplicate task-contract key: ${key}`);
      continue;
    }
    values[key] = value;
  }

  const untouchedTemplate = values["task-id"] === "agent-YYYYMMDD-NNN";
  if (untouchedTemplate) {
    return { participating: false, contract: null, errors: [] };
  }

  return { participating: true, contract: values, errors };
}

function parseRoundLimit(value, key, errors) {
  if (!/^\d+$/.test(value ?? "")) {
    errors.push(`${key} must be an integer between 1 and 3.`);
    return null;
  }
  const parsed = Number(value);
  if (parsed < 1 || parsed > 3) {
    errors.push(`${key} must be between 1 and 3.`);
    return null;
  }
  return parsed;
}

function scopeCoversPath(scope, path, config) {
  if (scope === "root") return true;
  if (config.scopeSharedPaths.some((prefix) => path.startsWith(prefix))) {
    return true;
  }
  return (config.scopePathPrefixes[scope] ?? []).some((prefix) =>
    path.startsWith(prefix),
  );
}

export function validateTaskContract(contract, context, config = loadConfig()) {
  const errors = [];
  const warnings = [];
  const missing = [...requiredContractKeys].filter(
    (key) => !Object.hasOwn(contract ?? {}, key) || contract[key] === "",
  );
  if (missing.length)
    errors.push(`Missing task-contract keys: ${missing.join(", ")}`);

  const implementer = contract?.implementer;
  if (!Object.hasOwn(config.branchPrefixes, implementer ?? "")) {
    errors.push("implementer must be codex or claude.");
  }
  const allowedAuthors = config.providerAuthorAllowlist?.[implementer] ?? [];
  if (
    typeof context.authorLogin !== "string" ||
    !allowedAuthors.includes(context.authorLogin)
  ) {
    errors.push(
      `PR author ${context.authorLogin ?? "unknown"} is not allowed for implementer ${implementer ?? "unknown"}.`,
    );
  }

  if (contract?.["base-branch"] !== context.baseBranch) {
    errors.push(
      `base-branch must match the PR base (${context.baseBranch ?? "unknown"}).`,
    );
  }
  if (context.baseBranch !== config.defaultBaseBranch) {
    errors.push(
      `PR base must be the configured default branch (${config.defaultBaseBranch}).`,
    );
  }
  if (contract?.["head-branch"] !== context.headBranch) {
    errors.push(
      `head-branch must match the PR head (${context.headBranch ?? "unknown"}).`,
    );
  }
  if (context.headRepository !== context.repository) {
    errors.push(
      "Agent-pipeline writes are not allowed for fork pull requests.",
    );
  }

  const expectedPrefix = config.branchPrefixes[implementer];
  if (
    expectedPrefix &&
    !contract?.["head-branch"]?.startsWith(expectedPrefix)
  ) {
    errors.push(
      `head-branch must start with ${expectedPrefix} for implementer ${implementer}.`,
    );
  }
  if (
    !/^agent-\d{8}-[a-z0-9][a-z0-9-]{2,31}$/.test(contract?.["task-id"] ?? "")
  ) {
    errors.push(
      "task-id must match agent-YYYYMMDD-<lowercase id> (3 to 32 id characters).",
    );
  }
  if (!/^[0-9a-f]{40}$/i.test(contract?.["base-sha"] ?? "")) {
    errors.push("base-sha must be a full 40-character commit SHA.");
  } else if (/^0{40}$/.test(contract["base-sha"])) {
    errors.push("base-sha must not be the template placeholder.");
  }
  if (!config.allowedScopes.includes(contract?.scope)) {
    errors.push(`scope must be one of: ${config.allowedScopes.join(", ")}.`);
  }
  if (!new Set(["yes", "no", "unknown"]).has(contract?.["ui-change"])) {
    errors.push("ui-change must be yes, no, or unknown.");
  }

  const codexThreadId = contract?.["codex-thread-id"];
  if (
    codexThreadId &&
    codexThreadId !== "none" &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      codexThreadId,
    )
  ) {
    errors.push("codex-thread-id must be a UUID or none.");
  }

  const maxCiFixRounds = parseRoundLimit(
    contract?.["max-ci-fix-rounds"],
    "max-ci-fix-rounds",
    errors,
  );
  const maxReviewRounds = parseRoundLimit(
    contract?.["max-review-rounds"],
    "max-review-rounds",
    errors,
  );

  const changedFiles = context.changedFiles ?? [];
  const uncoveredPaths = config.allowedScopes.includes(contract?.scope)
    ? changedFiles.filter(
        (path) => !scopeCoversPath(contract.scope, path, config),
      )
    : [];
  if (uncoveredPaths.length) {
    errors.push(
      `scope ${contract.scope} does not cover changed paths: ${uncoveredPaths.join(", ")}.`,
    );
  }
  const uiPathChanged = changedFiles.some((path) =>
    config.uiPathPrefixes.some((prefix) => path.startsWith(prefix)),
  );
  const protectedPaths = changedFiles.filter((path) =>
    config.protectedPathPrefixes.some((prefix) => path.startsWith(prefix)),
  );
  const uiChanged = uiPathChanged
    ? true
    : contract?.["ui-change"] === "yes"
      ? true
      : contract?.["ui-change"] === "no"
        ? false
        : null;
  if (contract?.["ui-change"] === "no" && uiPathChanged) {
    warnings.push(
      "ui-change was declared no, but a configured UI path changed; treating it as yes.",
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    normalized: {
      taskId: contract?.["task-id"] ?? null,
      implementer: implementer ?? null,
      baseBranch: contract?.["base-branch"] ?? null,
      baseSha: contract?.["base-sha"] ?? null,
      headBranch: contract?.["head-branch"] ?? null,
      scope: contract?.scope ?? null,
      uiChanged,
      maxCiFixRounds,
      maxReviewRounds,
      codexThreadId:
        codexThreadId && codexThreadId !== "none" ? codexThreadId : null,
      protectedPaths,
    },
  };
}

export function changedFiles(baseSha, headSha, cwd = repoRoot) {
  if (!baseSha || !headSha) return [];
  const output = execFileSync(
    "git",
    ["diff", "--no-renames", "--name-only", "-z", `${baseSha}...${headSha}`],
    { cwd, encoding: "utf8", windowsHide: true },
  );
  return output.split("\0").filter(Boolean);
}

function isAncestor(baseSha, headSha) {
  if (!baseSha || !headSha) return true;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", baseSha, headSha], {
      cwd: repoRoot,
      encoding: "utf8",
      windowsHide: true,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

export function validateBaseShaAncestry(
  declaredBaseSha,
  prBaseSha,
  headSha,
  ancestor = isAncestor,
) {
  const errors = [];
  if (declaredBaseSha && headSha && !ancestor(declaredBaseSha, headSha)) {
    errors.push(
      "The declared base-sha must be an ancestor of the current PR head.",
    );
  }
  if (declaredBaseSha && prBaseSha && !ancestor(declaredBaseSha, prBaseSha)) {
    errors.push("The declared base-sha must belong to the PR base branch.");
  }
  return errors;
}

function writeGithubOutput(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  const lines = Object.entries(values).map(
    ([key, value]) => `${key}=${value}\n`,
  );
  appendFileSync(process.env.GITHUB_OUTPUT, lines.join(""), "utf8");
}

function writeSummary(lines) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `${lines.join("\n")}\n`,
    "utf8",
  );
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return null;
  return args[index + 1];
}

function validateEventCommand(args) {
  const eventPath = option(args, "--event");
  const baseSha = option(args, "--base-sha");
  const headSha = option(args, "--head-sha");
  if (!eventPath) throw new Error("validate-event requires --event <path>.");

  const event = JSON.parse(readFileSync(eventPath, "utf8"));
  const pr = event.pull_request;
  if (!pr) throw new Error("GitHub event does not contain a pull_request.");

  const parsed = parseTaskContract(pr.body);
  if (!parsed.participating) {
    writeGithubOutput({ participating: "false" });
    writeSummary([
      "## Agent pipeline contract",
      "",
      "This pull request does not contain an active agent-pipeline task contract.",
    ]);
    return;
  }

  const sameRepository =
    pr.head?.repo?.full_name === event.repository?.full_name;
  const shaErrors = [];
  if (sameRepository) {
    for (const [name, sha] of [
      ["base-sha", baseSha],
      ["head-sha", headSha],
    ]) {
      if (!/^[0-9a-f]{40}$/i.test(sha ?? "")) {
        shaErrors.push(
          `Active same-repository contracts require --${name} with a full commit SHA.`,
        );
        continue;
      }
      try {
        execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], {
          cwd: repoRoot,
          encoding: "utf8",
          windowsHide: true,
          stdio: "pipe",
        });
      } catch {
        shaErrors.push(`--${name} does not resolve to an available commit.`);
      }
    }
  }
  const result = validateTaskContract(
    parsed.contract,
    {
      repository: event.repository?.full_name,
      headRepository: pr.head?.repo?.full_name,
      authorLogin: pr.user?.login,
      baseBranch: pr.base?.ref,
      headBranch: pr.head?.ref,
      changedFiles:
        sameRepository && shaErrors.length === 0
          ? changedFiles(baseSha, headSha)
          : [],
    },
    loadConfig(),
  );
  result.errors.unshift(...parsed.errors);
  result.errors.push(...shaErrors);
  if (sameRepository && shaErrors.length === 0) {
    result.errors.push(
      ...validateBaseShaAncestry(result.normalized.baseSha, baseSha, headSha),
    );
  }
  result.valid = result.errors.length === 0;

  writeGithubOutput({
    participating: "true",
    valid: String(result.valid),
    task_id: result.normalized.taskId ?? "",
    implementer: result.normalized.implementer ?? "",
    ui_changed:
      result.normalized.uiChanged === null
        ? "unknown"
        : String(result.normalized.uiChanged),
    protected_changed: String(result.normalized.protectedPaths.length > 0),
  });
  writeSummary([
    "## Agent pipeline contract",
    "",
    `- Task: \`${result.normalized.taskId ?? "unknown"}\``,
    `- Implementer: \`${result.normalized.implementer ?? "unknown"}\``,
    `- UI/UX change: \`${result.normalized.uiChanged === null ? "unknown" : result.normalized.uiChanged}\``,
    `- Protected paths changed: \`${result.normalized.protectedPaths.length > 0}\``,
    ...(result.warnings.length
      ? ["", "### Warnings", ...result.warnings.map((item) => `- ${item}`)]
      : []),
    ...(result.errors.length
      ? ["", "### Errors", ...result.errors.map((item) => `- ${item}`)]
      : []),
  ]);

  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  if (!result.valid) {
    throw new Error(
      `Invalid agent-pipeline task contract:\n- ${result.errors.join("\n- ")}`,
    );
  }
}

const isMainModule =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === "validate-event") validateEventCommand(args);
    else
      throw new Error(
        "Usage: node scripts/agent-pipeline.mjs validate-event --event <path> [--base-sha <sha> --head-sha <sha>]",
      );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
