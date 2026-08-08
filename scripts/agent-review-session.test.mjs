import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildResultMarker,
  claudeCommand,
  DEFAULT_FOCUS,
  detectWorktreeViolation,
  goalFromBody,
  launchSupport,
  parseVerdict,
  implementerFromBranch,
  parseOptions,
  readOnlyLevelFor,
  renderReviewPrompt,
  repositoryFromRemote,
  REVIEW_MODES,
  REVIEW_TOOLS,
  reviewerFor,
  usage,
  validatePullRequest,
} from "./agent-review-session.mjs";
import {
  meetsReadOnlyMinimum,
  REVIEW_READ_ONLY_LEVELS,
  REVIEW_RESULT_SOURCE,
} from "./agent-pipeline-reconcile.mjs";

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
    readOnlyLevel: "true",
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

test("each read-only level publishes exactly the marker it has earned", () => {
  assert.match(
    prompt({ readOnlyLevel: "true" }),
    new RegExp(`agent-pipeline:review-result ${HEAD} mode=cross .*read-only=true`),
  );
  // The level the launcher can back up itself: a checked worktree instead of a promise.
  assert.match(
    prompt({ readOnlyLevel: "verified" }),
    new RegExp(`agent-pipeline:review-result ${HEAD} mode=cross .*read-only=verified`),
  );

  // The forbidding instruction names the marker, so absence of the string proves nothing — what
  // must be absent is a marker line the reviewer could copy.
  const none = prompt({ readOnlyLevel: "false" });
  assert.equal(
    none.split("\n").find((line) => line.startsWith("<!-- agent-pipeline:review-result")),
    undefined,
  );
  assert.match(none, /Schreibe KEINEN/);
  // It must say so in the published comment too, not just decline the marker silently.
  assert.match(none, /Read-only-Stufe: false/);
});

test("the reviewer is told not to upgrade its own read-only level", () => {
  // The value describes how the session was started. A reviewer that edits it would be grading its
  // own independence, which is the one thing this whole mechanism exists to take away from it.
  assert.match(prompt({ readOnlyLevel: "verified" }), /Verändere den `read-only`-Wert nicht/);
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
  // The read-only flags must survive the headless switch, not be traded for it.
  const headless = claudeCommand({ headless: true });
  assert.ok(headless.includes("--print"));
  assert.deepEqual(headless.slice(0, 3), ["claude", "--tools", REVIEW_TOOLS]);
  assert.ok(headless.includes("--settings"));
  // Interactive stays the default: --print changes what the session is, so it is never implied.
  assert.ok(!command.includes("--print"));
});

test("an unattended run can be requested explicitly", () => {
  assert.equal(parseOptions(["--pr", "364"]).headless, false);
  assert.equal(parseOptions(["--pr", "364", "--headless"]).headless, true);
});

// ---------------------------------------------------------------------------
// From the cross-review of 00186da
// ---------------------------------------------------------------------------

test("the launcher refuses to run a review it would mislabel", () => {
  // It starts `claude` unconditionally, so any combination whose reviewer is codex would run Claude
  // while prompt, session id and marker all claim codex — and nobody watches an unattended run.
  const crossFromClaude = launchSupport({ mode: "cross", implementer: "claude" });
  assert.equal(crossFromClaude.ok, false);
  assert.match(crossFromClaude.reason, /only runs claude/);

  const selfFromCodex = launchSupport({ mode: "self", implementer: "codex" });
  assert.equal(selfFromCodex.ok, false);
  assert.match(selfFromCodex.reason, /only runs claude/);
});

test("the launcher refuses a cross run even when it could execute it", () => {
  // codex implementing + cross resolves to a claude reviewer, so the provider would be right — but
  // cross evidence is the counter provider's native approval. The reconciler's cross branch reads
  // snapshot.reviews and never a review-result marker, so this run would publish unusable evidence
  // and report success while doing it.
  const crossFromCodex = launchSupport({ mode: "cross", implementer: "codex" });
  assert.equal(crossFromCodex.ok, false);
  assert.match(crossFromCodex.reason, /native approval/);

  // The one combination this launcher can honestly run.
  assert.deepEqual(launchSupport({ mode: "self", implementer: "claude" }), {
    ok: true,
    reason: null,
  });
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
    const body = prompt({ reviewMode: mode, readOnlyLevel: "true" });
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

test("the read-only level follows what the launcher can actually back up", () => {
  // Only the operator knows about credentials.
  assert.equal(readOnlyLevelFor({ enforced: true, launch: true, headless: true }), "true");
  assert.equal(readOnlyLevelFor({ enforced: true, launch: false, headless: false }), "true");
  // Headless publishes from the launcher, after the check — that ordering is what `verified` means.
  assert.equal(readOnlyLevelFor({ enforced: false, launch: true, headless: true }), "verified");
  // --print-only never sees the session it hands the prompt to and can claim nothing.
  assert.equal(readOnlyLevelFor({ enforced: false, launch: false, headless: false }), "false");
});

test("an interactive run cannot claim verified, because it publishes before the check", () => {
  // Regression from the self-review of c16dd00: `verified` depended only on `launch`, so the
  // documented default call (interactive, no --enforced) produced a verified marker that the
  // session itself posted while still running — the check it names had not happened yet. Before
  // the level existed that same call wrote no marker at all, so this made a safe default unsafe.
  assert.equal(readOnlyLevelFor({ enforced: false, launch: true, headless: false }), "false");

  // And the two halves must stay consistent: whoever publishes decides which levels are reachable.
  const interactive = parseOptions(["--pr", "365"]);
  assert.equal(interactive.headless, false, "interactive is still the default");
  assert.equal(readOnlyLevelFor(interactive), "false");
  const none = prompt({ readOnlyLevel: readOnlyLevelFor(interactive), publisher: "session" });
  assert.equal(
    none.split("\n").find((line) => line.startsWith("<!-- agent-pipeline:review-result")),
    undefined,
    "an interactive default run must offer the session no marker to publish",
  );

  const headless = parseOptions(["--pr", "365", "--headless"]);
  assert.equal(readOnlyLevelFor(headless), "verified");
});

test("the unenforced prompt is honest about what is missing", () => {
  const none = prompt({ readOnlyLevel: "false" });
  assert.match(none, /Read-only-Stufe: false/);
  assert.match(none, /eine Shell eine breite Oberfläche/);
  assert.doesNotMatch(none, /read-only=true/);

  // `verified` must not read as if credentials were restricted — that is the whole difference.
  const verified = prompt({ readOnlyLevel: "verified" });
  assert.match(verified, /Die Credentials könnten jedoch schreiben/);
  assert.match(verified, /erkennt eine Verletzung, sie verhindert sie nicht/);
});

test("the enforced prompt does not overstate what the settings file blocks", () => {
  // The deny list names commands; it cannot match output redirection. Claiming "every writing path
  // through Bash" would put a false statement into the published review comment.
  const body = prompt({ readOnlyLevel: "true" });
  assert.match(body, /schreibende git- und gh-Befehle sind per Deny-Regel gesperrt/);
  assert.doesNotMatch(body, /Schreibpfade über Bash sind per Deny-Regel gesperrt/);
});

// ---------------------------------------------------------------------------
// Running without the GitHub CLI
//
// The launcher used to shell out to `gh` before producing anything at all, which made the whole
// review path unavailable in environments that reach GitHub some other way.
// ---------------------------------------------------------------------------

test("pull-request metadata can come from a file instead of gh", () => {
  const options = parseOptions(["--pr-json", "pr.json", "--repository", "o/r"]);
  assert.equal(options.prJsonFile, "pr.json");
  assert.equal(options.repository, "o/r");
  // The number lives in the file, so demanding --pr as well would only create a way to disagree.
  assert.equal(options.pr, null);
  assert.throws(() => parseOptions(["--mode", "self"]), /--pr <number> is required/);
});

test("supplied metadata is validated rather than trusted", () => {
  const valid = {
    number: 364,
    url: "https://example.invalid/pr/364",
    headRefName: "claude/x",
    headRefOid: HEAD,
    baseRefName: "main",
  };
  assert.equal(validatePullRequest(valid, "--pr-json f").number, 364);

  assert.throws(() => validatePullRequest(null, "--pr-json f"), /did not contain/);
  assert.throws(
    () => validatePullRequest({ ...valid, headRefOid: undefined }, "--pr-json f"),
    /missing required field\(s\): headRefOid/,
  );
  // A short SHA would reach `git worktree add` and fail there with a far less obvious message.
  assert.throws(
    () => validatePullRequest({ ...valid, headRefOid: "abc1234" }, "--pr-json f"),
    /not a full 40-char SHA/,
  );
});

test("the repository name can be derived from the origin remote", () => {
  assert.equal(
    repositoryFromRemote("https://github.com/blorbeer-cmd/LAN_2026.git"),
    "blorbeer-cmd/LAN_2026",
  );
  assert.equal(
    repositoryFromRemote("git@github.com:blorbeer-cmd/LAN_2026.git"),
    "blorbeer-cmd/LAN_2026",
  );
  assert.equal(repositoryFromRemote("https://github.com/blorbeer-cmd/LAN_2026"), "blorbeer-cmd/LAN_2026");
  assert.equal(repositoryFromRemote(""), null);
});

// ---------------------------------------------------------------------------
// The launcher and the gate must agree on the levels too
// ---------------------------------------------------------------------------

test("every read-only level the launcher emits is one the gate ranks", () => {
  for (const level of ["true", "verified", "false"]) {
    assert.ok(
      REVIEW_READ_ONLY_LEVELS.includes(level),
      `the gate cannot rank read-only=${level}`,
    );
    const body = prompt({ readOnlyLevel: level, reviewMode: "self" });
    const marker = body
      .split("\n")
      .find((line) => line.startsWith("<!-- agent-pipeline:review-result"));
    if (level === "false") {
      assert.equal(marker, undefined, "an unbacked level must publish no marker at all");
      continue;
    }
    const filled = marker.replace("<pass|changes-required|blocked>", "pass");
    assert.ok(new RegExp(REVIEW_RESULT_SOURCE).test(filled), `gate cannot read: ${filled}`);
  }
});

test("the check behind read-only=verified catches both ways a session can write", () => {
  const clean = { dirty: "", head: HEAD, expectedSha: HEAD };
  assert.equal(detectWorktreeViolation(clean).violated, false);

  // An uncommitted write shows up in git status.
  const dirty = detectWorktreeViolation({ ...clean, dirty: "?? VERLETZUNG.txt" });
  assert.equal(dirty.violated, true);
  assert.match(dirty.reasons.join("\n"), /VERLETZUNG\.txt/);

  // A committed one does not — the tree is clean again and only the SHA betrays it. Checking only
  // `git status` would have called this review untouched.
  const moved = detectWorktreeViolation({ ...clean, head: "b".repeat(40) });
  assert.equal(moved.violated, true);
  assert.match(moved.reasons.join("\n"), /HEAD moved to b{40}/);

  const both = detectWorktreeViolation({ dirty: "?? x", head: "b".repeat(40), expectedSha: HEAD });
  assert.equal(both.reasons.length, 2, "both findings must be reported, not just the first");
});

// ---------------------------------------------------------------------------
// The launcher publishes, so the marker follows the check instead of preceding it
// ---------------------------------------------------------------------------

test("a launcher-published review tells the session to write nothing at all", () => {
  const body = prompt({ readOnlyLevel: "verified", publisher: "launcher" });
  assert.match(body, /Poste NICHTS an GitHub/);
  assert.match(body, /Diese Session schreibt überhaupt nichts nach außen/);
  // No marker template: the session must not be able to produce one before the check has run.
  assert.equal(
    body.split("\n").find((line) => line.startsWith("<!-- agent-pipeline:review-result")),
    undefined,
  );
  // The session-published variant keeps its own instructions.
  assert.match(prompt({ readOnlyLevel: "verified" }), /Poste genau einen Kommentar/);
});

test("the verdict is read from the review, never guessed", () => {
  assert.equal(parseVerdict("- Verdikt: pass"), "pass");
  assert.equal(parseVerdict("Verdikt: `changes-required`"), "changes-required");
  assert.equal(parseVerdict("...\n- Verdikt: blocked\n..."), "blocked");

  // An untouched template lists all three; treating that as a pass would open the gate on nothing.
  assert.equal(parseVerdict("- Verdikt: pass | changes-required | blocked"), null);
  // Two different verdicts in one text is a contradiction, not a decision.
  assert.equal(parseVerdict("- Verdikt: pass\n- Verdikt: blocked"), null);
  assert.equal(parseVerdict("no verdict here"), null);
  assert.equal(parseVerdict(""), null);
});

test("the marker the launcher builds is one the gate can read", () => {
  const marker = buildResultMarker({
    headSha: HEAD,
    reviewMode: "self",
    verdict: "pass",
    sessionId: "claude-review-1",
    readOnlyLevel: "verified",
  });
  assert.ok(new RegExp(REVIEW_RESULT_SOURCE).test(marker), marker);
  assert.match(marker, /read-only=verified/);
});

test("a result file can be requested explicitly", () => {
  assert.equal(parseOptions(["--pr", "364"]).resultFile, null);
  assert.equal(parseOptions(["--pr", "364", "--result-file", "out.md"]).resultFile, "out.md");
});

test("the default minimum accepts a verified launcher run but not an unbacked one", () => {
  assert.ok(meetsReadOnlyMinimum("true"));
  assert.ok(meetsReadOnlyMinimum("verified"));
  assert.ok(!meetsReadOnlyMinimum("false"));
});

// ---------------------------------------------------------------------------
// From the review of 07f515b
// ---------------------------------------------------------------------------

test("the goal survives a capital Z, a final section and a Z-initial sentence", () => {
  // `\Z` is no anchor in JavaScript: written as one it matched a literal "Z", so a lazy body ended
  // at the first capital Z — and German goals are full of them.
  const midText =
    "## Ziel\n\nDer Nutzer waehlt den Reviewer.\nZiel ist eine Wahl pro Head-SHA.\n\n## Änderungen\n\n- x\n";
  assert.equal(
    goalFromBody(midText, "Titel"),
    "Der Nutzer waehlt den Reviewer.\nZiel ist eine Wahl pro Head-SHA.",
    "the acceptance criterion after the capital Z must not be dropped",
  );

  // `## Ziel` as the last section: no following heading and no Z to stop at.
  assert.equal(goalFromBody("## Ziel\n\nEin Satz ohne alles.\n", "Titel"), "Ein Satz ohne alles.");

  // Starting with a Z-word used to yield an empty section and fall back to the title.
  assert.equal(
    goalFromBody("## Ziel\n\nZiel ist X.\n\n## Andere\n\ny", "Titel"),
    "Ziel ist X.",
  );
});

test("the usage text advertises exactly the modes the parser accepts", () => {
  // A hand-written copy advertised `fallback` one line below the error rejecting it.
  const text = usage();
  for (const mode of REVIEW_MODES) {
    assert.match(text, new RegExp(`\\b${mode}\\b`), `usage must mention ${mode}`);
  }
  assert.doesNotMatch(text.split("\n")[1], /fallback/, "the mode list must not offer fallback");
  assert.match(text, /--enforced/, "the flag that decides gate eligibility must be documented");
});
