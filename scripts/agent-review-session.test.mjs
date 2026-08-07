import assert from "node:assert/strict";
import { test } from "node:test";

import {
  claudeCommand,
  DEFAULT_FOCUS,
  goalFromBody,
  implementerFromBranch,
  parseOptions,
  renderReviewPrompt,
  REVIEW_MODES,
  REVIEW_TOOLS,
  reviewerFor,
} from "./agent-review-session.mjs";
import { REVIEW_RESULT_SOURCE } from "./agent-pipeline-reconcile.mjs";

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

// ---------------------------------------------------------------------------
// The launcher and the gate must agree
//
// From the review of 5ebf032: the launcher accepted a mode whose marker the reconciler could never
// read, and asserted the one flag the gate checks without doing anything to earn it.
// ---------------------------------------------------------------------------

test("every marker the launcher can produce is one the gate can read", () => {
  const pattern = new RegExp(REVIEW_RESULT_SOURCE);
  for (const mode of REVIEW_MODES) {
    const body = prompt({ reviewMode: mode, readOnlyEnforced: true });
    const marker = body
      .split("\n")
      .find((line) => line.startsWith("<!-- agent-pipeline:review-result"));
    // The prompt leaves the verdict as a placeholder for the reviewer to fill in.
    const filled = marker.replace("<pass|changes-required|blocked>", "pass");
    assert.ok(pattern.test(filled), `the gate cannot read a ${mode} marker: ${filled}`);
  }
});

test("a mode the gate does not know is rejected instead of silently produced", () => {
  // A fallback review runs as `self` and is marked by the agent:review-fallback label; a third
  // marker mode would be published, cost quota and then never be read.
  assert.throws(() => parseOptions(["--pr", "1", "--mode", "fallback"]), /--mode must be one of/);
  assert.throws(() => parseOptions(["--pr", "1", "--mode", "human"]), /--mode must be one of/);
});

test("read-only is asserted only when the operator says so", () => {
  assert.equal(parseOptions(["--pr", "363"]).enforced, false);
  assert.equal(parseOptions(["--pr", "363", "--enforced"]).enforced, true);
});

test("without the assertion the prompt is honest about what is missing", () => {
  const body = prompt({ readOnlyEnforced: false });
  assert.match(body, /Read-only technisch erzwungen: nein/);
  assert.match(body, /eine Shell eine breite Oberfläche/);
  assert.doesNotMatch(body, /read-only=true/);
});

test("the enforced prompt does not overstate what the settings file blocks", () => {
  // The deny list names commands; it cannot match output redirection. Claiming "every writing path
  // through Bash" would put a false statement into the published review comment.
  const body = prompt({ readOnlyEnforced: true });
  assert.match(body, /schreibende git- und gh-Befehle sind per Deny-Regel gesperrt/);
  assert.doesNotMatch(body, /Schreibpfade über Bash sind per Deny-Regel gesperrt/);
});
