import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  changedFiles,
  loadConfig,
  parseTaskContract,
  validateBaseShaAncestry,
  validateTaskContract,
} from "./agent-pipeline.mjs";

const baseSha = "1".repeat(40);
const headSha = "2".repeat(40);
const config = loadConfig();

function body(overrides = {}) {
  const values = {
    "task-id": "agent-20260726-foundation",
    implementer: "codex",
    "base-branch": "main",
    "base-sha": baseSha,
    "head-branch": "codex/agent-pipeline-foundation",
    scope: "infra",
    "ui-change": "no",
    "max-ci-fix-rounds": "3",
    "max-review-rounds": "3",
    ...overrides,
  };
  return `<!--\nagent-pipeline:task\n${Object.entries(values)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")}\nagent-pipeline:end\n-->`;
}

function context(changedFiles = ["scripts/agent-pipeline.mjs"]) {
  return {
    repository: "blorbeer-cmd/LAN_2026",
    headRepository: "blorbeer-cmd/LAN_2026",
    authorLogin: "blorbeer-cmd",
    baseBranch: "main",
    headBranch: "codex/agent-pipeline-foundation",
    changedFiles,
  };
}

function validContract(overrides = {}, changedFiles) {
  const parsed = parseTaskContract(body(overrides));
  assert.equal(parsed.participating, true);
  const validation = validateTaskContract(
    parsed.contract,
    context(changedFiles),
    config,
  );
  assert.deepEqual(validation.errors, []);
  return validation.normalized;
}

function runValidatorCli(prBody, eventOverrides = {}, shaOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), "agent-pipeline-test-"));
  const eventPath = join(directory, "event.json");
  const outputPath = join(directory, "output.txt");
  const summaryPath = join(directory, "summary.md");
  const event = {
    repository: { full_name: "blorbeer-cmd/LAN_2026" },
    pull_request: {
      body: prBody,
      user: { login: "blorbeer-cmd" },
      base: { ref: "main" },
      head: {
        ref: "codex/agent-pipeline-foundation",
        repo: { full_name: "blorbeer-cmd/LAN_2026" },
      },
    },
    ...eventOverrides,
  };
  writeFileSync(eventPath, JSON.stringify(event), "utf8");
  const cliArgs = [
    fileURLToPath(new URL("./agent-pipeline.mjs", import.meta.url)),
    "validate-event",
    "--event",
    eventPath,
  ];
  if (shaOptions.baseSha) {
    cliArgs.push("--base-sha", shaOptions.baseSha);
  }
  if (shaOptions.headSha) {
    cliArgs.push("--head-sha", shaOptions.headSha);
  }
  const result = spawnSync(process.execPath, cliArgs, {
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      GITHUB_OUTPUT: outputPath,
      GITHUB_STEP_SUMMARY: summaryPath,
    },
  });
  const output = readFileSync(outputPath, "utf8");
  const summary = readFileSync(summaryPath, "utf8");
  rmSync(directory, { recursive: true, force: true });
  return { result, output, summary };
}

test("an untouched PR template does not activate the pipeline", () => {
  const parsed = parseTaskContract(
    `agent-pipeline:task\nTask-id: ignored\ntask-id: agent-YYYYMMDD-NNN\nagent-pipeline:end`,
  );
  assert.equal(parsed.participating, false);
});

test("a complete task contract is parsed and normalized", () => {
  const contract = validContract();
  assert.equal(contract.taskId, "agent-20260726-foundation");
  assert.equal(contract.implementer, "codex");
  assert.equal(contract.maxCiFixRounds, 3);
  assert.equal(contract.uiChanged, false);
});

test("the CLI exposes validated contract metadata as GitHub outputs", () => {
  // Both SHAs point at HEAD so the diff is empty and the assertion does not depend on whatever
  // the surrounding checkout happens to contain. Scope coverage against a real diff is asserted
  // by the dedicated scope tests below; mixing both here made this test fail whenever the working
  // copy sat on unrelated commits.
  const actualHeadSha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const actualBaseSha = actualHeadSha;
  const { result, output, summary } = runValidatorCli(
    body({ "base-sha": actualBaseSha }),
    {},
    { baseSha: actualBaseSha, headSha: actualHeadSha },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(output, /^participating=true$/m);
  assert.match(output, /^valid=true$/m);
  assert.match(output, /^task_id=agent-20260726-foundation$/m);
  assert.match(summary, /Agent pipeline contract/);
});

test("the CLI rejects an active contract from a fork", () => {
  const { result, output } = runValidatorCli(body(), {
    repository: { full_name: "blorbeer-cmd/LAN_2026" },
    pull_request: {
      body: body(),
      user: { login: "blorbeer-cmd" },
      base: { ref: "main" },
      head: {
        ref: "codex/agent-pipeline-foundation",
        repo: { full_name: "someone/fork" },
      },
    },
  });
  assert.equal(result.status, 1);
  assert.match(output, /^valid=false$/m);
  assert.match(result.stderr, /fork pull requests/);
});

test("branch identity, repository origin and required keys are enforced", () => {
  const parsed = parseTaskContract(
    body({ implementer: "claude", "head-branch": "codex/wrong" }),
  );
  const result = validateTaskContract(
    parsed.contract,
    { ...context(), headRepository: "someone/fork" },
    config,
  );
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) => error.includes("fork pull requests")),
  );
  assert.ok(result.errors.some((error) => error.includes("claude/")));
});

test("the declared provider is bound to an allowed PR author", () => {
  const parsed = parseTaskContract(body());
  const denied = validateTaskContract(
    parsed.contract,
    { ...context(), authorLogin: "untrusted-user" },
    config,
  );
  assert.equal(denied.valid, false);
  assert.match(denied.errors.join("\n"), /not allowed for implementer codex/);

  const allowed = validateTaskContract(
    parsed.contract,
    { ...context(), authorLogin: "chatgpt-codex-connector[bot]" },
    config,
  );
  assert.equal(allowed.valid, true);
});

test("active same-repository CLI validation requires resolvable SHAs", () => {
  const { result, output, summary } = runValidatorCli(body());
  assert.equal(result.status, 1);
  assert.match(output, /^valid=false$/m);
  assert.match(summary, /require --base-sha with a full commit SHA/i);
  assert.match(summary, /require --head-sha with a full commit SHA/i);
});

test("UI paths override an incorrect no declaration and protected paths are reported", () => {
  const parsed = parseTaskContract(body({ scope: "root" }));
  const result = validateTaskContract(
    parsed.contract,
    context(["server/public/app.js", ".github/workflows/deploy.yml"]),
    config,
  );
  assert.equal(result.valid, true);
  assert.equal(result.normalized.uiChanged, true);
  assert.deepEqual(result.normalized.protectedPaths, [
    ".github/workflows/deploy.yml",
  ]);
  assert.equal(result.warnings.length, 1);
});

test("declared scope must cover non-documentation changed paths", () => {
  const parsed = parseTaskContract(body({ scope: "docs" }));
  const invalid = validateTaskContract(
    parsed.contract,
    context(["server/src/index.ts"]),
    config,
  );
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join("\n"), /scope docs does not cover/);

  const root = validateTaskContract(
    parseTaskContract(body({ scope: "root" })).contract,
    context(["server/src/index.ts", ".github/workflows/deploy.yml"]),
    config,
  );
  assert.equal(root.valid, true);
});

test("changed files are classified from the merge base", () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-pipeline-git-"));
  try {
    execFileSync("git", ["init", "-b", "main"], { cwd: directory });
    execFileSync("git", ["config", "user.name", "Agent Pipeline Test"], {
      cwd: directory,
    });
    execFileSync("git", ["config", "user.email", "agent@example.invalid"], {
      cwd: directory,
    });
    writeFileSync(join(directory, "common.txt"), "common\n", "utf8");
    mkdirSync(join(directory, "server", "src"), { recursive: true });
    writeFileSync(
      join(directory, "server", "src", "auth.ts"),
      "export {};\n",
      "utf8",
    );
    execFileSync("git", ["add", "."], { cwd: directory });
    execFileSync("git", ["commit", "-m", "common"], { cwd: directory });
    execFileSync("git", ["checkout", "-b", "feature"], { cwd: directory });
    mkdirSync(join(directory, "docs"), { recursive: true });
    execFileSync("git", ["mv", "server/src/auth.ts", "docs/auth.ts"], {
      cwd: directory,
    });
    writeFileSync(join(directory, "feature.txt"), "feature\n", "utf8");
    execFileSync("git", ["add", "."], { cwd: directory });
    execFileSync("git", ["commit", "-m", "feature"], { cwd: directory });
    const featureSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: directory,
      encoding: "utf8",
    }).trim();
    execFileSync("git", ["checkout", "main"], { cwd: directory });
    writeFileSync(join(directory, "main-only.txt"), "main\n", "utf8");
    execFileSync("git", ["add", "."], { cwd: directory });
    execFileSync("git", ["commit", "-m", "main"], { cwd: directory });
    const baseTip = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: directory,
      encoding: "utf8",
    }).trim();
    assert.deepEqual(changedFiles(baseTip, featureSha, directory), [
      "docs/auth.ts",
      "feature.txt",
      "server/src/auth.ts",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the real git ancestor check accepts and rejects actual commits", () => {
  // Exercises validateBaseShaAncestry through its default `isAncestor`, which shells out to
  // `git merge-base --is-ancestor`. The mocked test below covers the branching, but only this one
  // proves the subprocess itself still behaves as the contract assumes.
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const parent = execFileSync("git", ["rev-parse", "HEAD~1"], {
    encoding: "utf8",
  }).trim();
  assert.notEqual(head, parent);

  // The parent really is an ancestor of HEAD, so nothing is reported.
  assert.deepEqual(validateBaseShaAncestry(parent, parent, head), []);

  // Reversed, HEAD is not an ancestor of its own parent, so both checks must fire.
  const errors = validateBaseShaAncestry(head, parent, parent);
  assert.ok(
    errors.some((error) => error.includes("ancestor of the current PR head")),
  );
  assert.ok(errors.some((error) => error.includes("base branch")));

  // A commit is its own ancestor, so the self-comparison must stay silent.
  assert.deepEqual(validateBaseShaAncestry(head, head, head), []);
});

test("declared base SHA must also belong to the PR base branch", () => {
  const fabricatedBase = headSha;
  const errors = validateBaseShaAncestry(
    fabricatedBase,
    baseSha,
    headSha,
    (ancestor, descendant) =>
      ancestor === descendant ||
      (ancestor === baseSha && descendant === headSha),
  );
  assert.ok(errors.some((error) => error.includes("base branch")));
});
