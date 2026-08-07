import assert from "node:assert/strict";
import { test } from "node:test";

import {
  claudeCommand,
  DEFAULT_FOCUS,
  goalFromBody,
  implementerFromBranch,
  parseOptions,
  renderReviewPrompt,
  REVIEW_TOOLS,
  reviewerFor,
} from "./agent-review-session.mjs";

const HEAD = "a".repeat(40);
const BASE = "c".repeat(40);

function prompt(overrides = {}) {
  return renderReviewPrompt({
    repository: "blorbeer-cmd/LAN_2026",
    pullNumber: 363,
    pullUrl: "https://github.com/blorbeer-cmd/LAN_2026/pull/363",
    baseBranch: "main",
    baseSha: BASE,
    headBranch: "claude/x",
    headSha: HEAD,
    implementer: "claude",
    reviewerProvider: "codex",
    reviewMode: "cross",
    sessionId: "claude-review-1",
    readOnlyEnforced: true,
    taskGoal: "Ziel des Auftrags.",
    focus: DEFAULT_FOCUS,
    ...overrides,
  });
}

test("the prompt binds the review to one exact head SHA", () => {
  const body = prompt();
  assert.match(body, new RegExp(`Erwarteter Head-SHA: ${HEAD}`));
  assert.match(body, new RegExp(`git diff ${BASE}\\.\\.\\.${HEAD}`));
  // A verdict for another SHA is worthless, so the reviewer must stop rather than guess.
  assert.match(body, /stoppe mit verdict "blocked"/);
});

test("an enforced session may publish the gate marker, an unenforced one may not", () => {
  const enforced = prompt();
  assert.match(
    enforced,
    new RegExp(`agent-pipeline:review-result ${HEAD} mode=cross .*read-only=true`),
  );

  const unenforced = prompt({ readOnlyEnforced: false });
  assert.doesNotMatch(unenforced, /read-only=true/);
  assert.match(unenforced, /Schreibe KEINEN/);
  // It must say so in the published comment too, not just decline the marker silently.
  assert.match(unenforced, /Read-only technisch erzwungen: nein/);
});

test("the prompt allows exactly one write: the findings comment", () => {
  const body = prompt();
  assert.match(body, /einzige erlaubte Schreiboperation ist genau ein Kommentar/);
  assert.match(body, /setze oder entferne kein\n   Label/);
  assert.match(body, /löse keine Review-Threads auf/);
  // Self-reported, and verified from outside by the launcher afterwards.
  assert.match(body, /git status --porcelain/);
});

test("the prompt never carries the implementation session's reasoning", () => {
  const body = prompt();
  assert.match(body, /Verwende keinen Implementierungs-Chatverlauf/);
});

test("the session is launched without the editing tools", () => {
  const command = claudeCommand();
  assert.deepEqual(command.slice(0, 3), ["claude", "--tools", REVIEW_TOOLS]);
  for (const tool of ["Edit", "Write", "NotebookEdit"]) {
    assert.ok(!REVIEW_TOOLS.includes(tool), `${tool} must not be available to a reviewer`);
  }
  assert.ok(command.includes("--settings"));
});

test("only the cross mode switches the provider", () => {
  assert.equal(reviewerFor("claude", "cross"), "codex");
  assert.equal(reviewerFor("codex", "cross"), "claude");
  assert.equal(reviewerFor("claude", "self"), "claude");
  assert.equal(reviewerFor("codex", "fallback"), "codex");
});

test("the implementer is read from the branch prefix", () => {
  assert.equal(implementerFromBranch("claude/review-mode"), "claude");
  assert.equal(implementerFromBranch("codex/spotify"), "codex");
  assert.equal(implementerFromBranch("feature/manual"), null);
});

test("options are validated instead of guessed", () => {
  assert.deepEqual(parseOptions(["--pr", "363"]).pr, "363");
  assert.equal(parseOptions(["--pr", "363", "--mode", "self"]).mode, "self");
  assert.equal(parseOptions(["--pr", "363", "--print-only"]).launch, false);

  assert.throws(() => parseOptions([]), /--pr <number> is required/);
  assert.throws(() => parseOptions(["--pr", "abc"]), /--pr <number> is required/);
  assert.throws(() => parseOptions(["--pr", "1", "--mode", "skip"]), /--mode must be one of/);
  assert.throws(() => parseOptions(["--nonsense"]), /Unknown option/);
});

test("the goal comes from the pull request, never invented", () => {
  const body = "## Ziel\n\n<!-- hint -->\nDas Gate soll den Modus kennen.\n\n## Änderungen\n\nEgal.";
  assert.equal(goalFromBody(body, "Titel"), "Das Gate soll den Modus kennen.");
  // An empty template section must fall back to the title rather than pass the comment along.
  assert.equal(goalFromBody("## Ziel\n\n<!-- Was soll dieser PR erreichen? -->\n", "Titel"), "Titel");
  assert.match(goalFromBody("", ""), /Im Pull Request beschrieben/);
});
