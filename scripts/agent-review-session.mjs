// Launcher for a separate, read-only Claude review session.
//
// The review prompt asks a session not to write. That is instruction, not enforcement: a prompt
// cannot stop the session it is addressed to. Enforcement has to come from outside, which is what
// this script assembles — the editing tools are removed from the session, the writing git and gh
// subcommands are denied by `review-readonly.settings.json`, and the review happens in a throwaway
// worktree detached at the exact head SHA.
//
// What this script does *not* do is the layer that would make the claim airtight: restricted
// credentials and a genuinely unwritable tree. A shell stays a wide surface, and the check below
// runs after the session ended — it detects a violation, it does not prevent one, and by then a
// review-result marker may already be posted. So `read-only=true` is not asserted here.
// `--enforced` is how the operator states they put that layer in place.
//
// Without it the review is not worthless, though, which is what `read-only=verified` records: this
// script removed the editing tools, denied the writing git/gh commands, detached a throwaway
// worktree at the reviewed SHA and checked afterwards that nothing in it moved. That is real,
// externally checked evidence — weaker than restricted credentials, stronger than a promise. It
// exists because `true` is unreachable wherever the only available credentials can push, which used
// to leave self-review unusable in exactly those environments.
//
// `--print-only` hands the prompt to a session this script never observes, so it can claim neither
// and stays at `read-only=false`.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./agent-pipeline.mjs";

export const SETTINGS_PATH = ".github/agent-pipeline/review-readonly.settings.json";

// Read, search and inspect. Edit, Write and NotebookEdit are absent on purpose: a tool that is not
// in this list does not exist in the session and cannot be called at all.
export const REVIEW_TOOLS = "Read,Grep,Glob,Bash";

// The gate knows exactly these two as evidence-bearing review modes. A fallback review — the
// counter provider was unavailable and the user picked the implementer instead — runs as `self`
// and is marked as a fallback by the `agent:review-fallback` label, not by a third marker mode the
// reconciler would never read.
export const REVIEW_MODES = new Set(["cross", "self"]);

/**
 * Builds the complete review prompt.
 *
 * Pure, so the wording is covered by tests and a caller can print it without launching anything.
 * Everything the reviewer learns comes from the pull request and the repository — never from the
 * implementation session's reasoning, which is the whole reason for a separate session.
 */
export function renderReviewPrompt({
  repository,
  pullNumber,
  pullUrl,
  baseBranch,
  baseSha,
  headBranch,
  headSha,
  implementer,
  reviewerProvider,
  reviewMode,
  sessionId,
  readOnlyLevel,
  taskGoal,
  focus,
  // Who turns the review into a pull-request comment. `launcher` is the safer order: the marker is
  // appended only after the worktree check passed, so a violating session never leaves one behind.
  publisher = "session",
}) {
  // The level is printed right before this, so these read as its explanation and must not repeat it
  // with another ja/nein of their own.
  const enforcement =
    readOnlyLevel === "true"
      ? "Editierwerkzeuge sind der Session entzogen, schreibende git- und gh-Befehle sind per Deny-Regel gesperrt, die Credentials haben kein Code-Schreibrecht, und der Arbeitsbaum wird nach der Session von außen geprüft"
      : readOnlyLevel === "verified"
        ? "Editierwerkzeuge sind entzogen, schreibende git-/gh-Befehle gesperrt, das Review läuft in einem eigenen, auf den Head-SHA detachten Arbeitsbaum, und der Launcher prüft nach der Session von außen, dass darin nichts verändert wurde. Die Credentials könnten jedoch schreiben; die Prüfung erkennt eine Verletzung, sie verhindert sie nicht"
        : "Editierwerkzeuge sind zwar entzogen und schreibende git-/gh-Befehle gesperrt, aber ohne eingeschränkte Credentials und ohne äußere Prüfung bleibt eine Shell eine breite Oberfläche";

  const marker =
    publisher === "launcher"
      ? [
          "Poste NICHTS an GitHub und schreibe KEINEN",
          "`<!-- agent-pipeline:review-result ... -->`-Marker. Gib das vollständige Review oben als",
          "deine Antwort aus — mehr nicht.",
          "",
          "Der Launcher nimmt diese Ausgabe entgegen, prüft danach von außen, dass du den Arbeitsbaum",
          "nicht verändert hast, und veröffentlicht erst dann Ergebnis und Marker. Ein Marker, den du",
          "selbst schriebest, existierte bereits, bevor diese Prüfung gelaufen ist.",
        ].join("\n")
      : readOnlyLevel === "false"
      ? [
          "Schreibe KEINEN `<!-- agent-pipeline:review-result ... -->`-Marker. Read-only ist hier",
          "weder erzwungen noch von außen geprüft; der Marker würde dem Merge-Gate ein Review",
          "vortäuschen, dessen Voraussetzung fehlt. Dieses Review dient dann als inhaltliche Prüfung",
          "für den Nutzer.",
        ].join("\n")
      : [
          "Schreibe als letzte Zeile des Kommentars zusätzlich diesen Marker, damit das Merge-Gate das",
          "Review sehen kann:",
          "",
          `<!-- agent-pipeline:review-result ${headSha} mode=${reviewMode} verdict=<pass|changes-required|blocked> session=${sessionId} read-only=${readOnlyLevel} -->`,
          "",
          "Setze `verdict` auf denselben Wert wie oben. Schreibe den Marker nicht, wenn du oben mit",
          "`blocked` abgebrochen hast, weil Identität oder Head-SHA nicht stimmten.",
          "Verändere den `read-only`-Wert nicht: er beschreibt, wie diese Session gestartet wurde,",
          "nicht wie sie sich verhalten hat.",
        ].join("\n");

  return `Du bist der unabhängige, ausschließlich lesende Reviewer für einen Pull Request. Du hast
diesen Code nicht geschrieben und keinen Zugriff auf die Implementierungs-Session. Leite alles
selbst aus Auftrag, Diff, Quellcode, Tests und Repository-Regeln ab.

Repository: ${repository}
Pull Request: #${pullNumber} — ${pullUrl}
Base-Branch: ${baseBranch}${baseSha ? ` (${baseSha})` : ""}
Erwarteter Head-Branch: ${headBranch}
Erwarteter Head-SHA: ${headSha}
Implementierungs-Agent: ${implementer}
Review-Anbieter: ${reviewerProvider}
Review-Modus: ${reviewMode}
Review-Session-ID: ${sessionId}
Read-only-Stufe: ${readOnlyLevel} — ${enforcement}

Ziel und Abnahmekriterien des geprüften Auftrags:
${taskGoal}

Regeln für diese Session:

1. Dies ist ausschließlich ein Review. Ändere keine Datei, erstelle keinen Commit, pushe nichts,
   approviere und merge den PR nicht, löse keine Review-Threads auf und setze oder entferne kein
   Label. ${
     publisher === "launcher"
       ? "Diese Session schreibt überhaupt nichts nach außen; dein Ergebnis ist deine Antwort."
       : "Die einzige erlaubte Schreiboperation ist genau ein Kommentar am Pull Request mit deinem\n   Ergebnis."
   }
   Prüfe zu Beginn und am Ende \`git status --porcelain\` und nenne beide Ergebnisse im Ergebnistext.
   Weicht das zweite vom ersten ab, melde das ausdrücklich als Verletzung.
2. Verwende keinen Implementierungs-Chatverlauf und übernimm keine dortige Begründung.
3. Lies zuerst AGENTS.md und DEVELOPMENT_GUIDELINES.md vollständig. Lade danach nur die für die
   geänderten Pfade vorgeschriebenen Bereichsregeln. Führe keinen Änderungs-Preflight aus, weil
   dieses Review schreibgeschützt ist.
4. Prüfe vor der Analyse Repository, Pull Request, Base-Branch, Head-Branch und vollständigen
   Head-SHA. Weicht etwas von den erwarteten Werten ab, stoppe mit verdict "blocked" und nenne die
   Abweichung. Ein Review eines älteren SHAs ist ungültig.
5. Reviewe den vollständigen Diff von der Merge-Base bis zum Head, nicht nur den letzten Commit:
   \`git diff ${baseSha || baseBranch}...${headSha}\`
   Berücksichtige relevante Aufrufer, Datenflüsse, Schema- und Realtime-Auswirkungen sowie bereits
   vorhandene Tests.

Prüfschwerpunkte:

${focus}

Bewertungsregeln:

- Melde nur konkrete, durch den Diff verursachte und vom Autor behebbare Findings. Keine
  allgemeinen Stilwünsche, keine bloßen Fragen und nichts, was ein bereits grüner deterministischer
  Linter abdeckt.
- Belege jedes Finding mit engem Datei-/Zeilenbezug, einem reproduzierbaren Szenario oder einer
  klaren Ausführungskette, und nenne eine konkrete Verifikation des Fixes.
- Erfinde keine Testergebnisse. Du darfst die Testsuiten des Repositories ausführen, weil sie nichts
  verändern; nenne dann das tatsächliche Ergebnis. Führe keine zustandsändernden Aktionen aus.
- Schweregrade:
  - critical: Datenverlust, Sicherheitsgrenze, produktiver Ausfall oder sicher falsches
    Kernverhalten; blockiert zwingend.
  - high: wahrscheinlicher funktionaler Fehler oder relevante Regression; blockiert.
  - medium: realer Fehler in begrenztem Pfad oder wesentliche Testlücke; blockiert bis behoben oder
    fachlich überzeugend widerlegt.
  - low: kleiner, realer Defekt; nicht für Geschmacksfragen verwenden.
- Findest du keine Findings, sage das ausdrücklich. Ein positives Urteil gilt nur für den exakt
  geprüften Head-SHA.

Ergebnis ausgeben:

${
  publisher === "launcher"
    ? `Gib genau diesen Aufbau als deine Antwort aus (der Launcher veröffentlicht ihn an Pull Request #${pullNumber}):`
    : `Poste genau einen Kommentar an Pull Request #${pullNumber} mit diesem Aufbau:`
}

## Review-Ergebnis (${reviewerProvider}, separate Session, Modus ${reviewMode})

- Geprüfter Head-SHA: ${headSha}
- Review-Session-ID: ${sessionId}
- Read-only-Stufe: ${readOnlyLevel}
- Arbeitsbaum vor/nach dem Review: <Ausgabe von git status --porcelain, oder "sauber">
- Verdikt: pass | changes-required | blocked

### Findings

Je Finding, absteigend nach Schwere:

[severity] Kurzer imperativer Titel
- Datei: <pfad>:<zeile>
- Problem: <konkretes Fehlverhalten und Auslöser>
- Auswirkung: <warum relevant>
- Evidenz: <Codepfad, reproduzierbares Szenario oder Testlücke>
- Verifikation: <wie der Fix geprüft werden soll>

Gibt es keine, schreibe exakt: Keine Findings zum geprüften Head-SHA.

### Rest-Risiken und Prüfgrenzen

Nicht ausgeführte Prüfungen oder "Keine". Findings hier nicht wiederholen.

${marker}

Beende den Kommentar mit:

---
_Generated by [Claude Code](https://claude.ai/code)_
`;
}

/** Default focus list: what a reviewer should look at in any change to this repository. */
export const DEFAULT_FOCUS = `- Korrektheit, Regressionen, Zustandskonflikte, Nebenläufigkeit und Fehlerpfade.
- Validierung externer Eingaben nach Typ, Format, Länge, erlaubten Werten und referenzierten
  Entitäten; erwartbare Fehler dürfen keine ungefangenen Exceptions auslösen.
- Authentifizierung, Admin-Rechte, Gruppen- und Mandantengrenzen, LAN-/Loopback-Bindung.
- Datenverlust und riskante Datenbankmigrationen.
- Escaping von Nutzerinhalten vor HTML-Ausgabe und Parametrisierung dynamischer SQL-Werte.
- Testlücken: Happy Path, relevante Validierungsfehler und Zustandskonflikte für jede geänderte
  Logik; sind neue Tests echte Zusicherungen oder Tautologien?
- Wurden bestehende Tests durch geänderte gemeinsame Fixtures still entschärft?
- Widersprüche zwischen Dokumentation und tatsächlichem Verhalten, auch zwischen Dokumenten.
- Bei UI/UX-Änderungen zusätzlich: responsive Zustände, Tastaturbedienung, Barrierefreiheit,
  Design-Tokens, Lade-/Fehler-/Leerzustände und ob die Prüfanleitung die sichtbare Änderung
  abdeckt.`;

/**
 * `claude` invocation that makes the session read-only from the outside.
 *
 * `headless` adds `--print`, which is what turns this from "the operator pastes the prompt into an
 * interactive session" into something that can actually run unattended. Without it the launcher
 * starts a bare session and waits for a human — fine at a workstation, useless in the automation
 * this script exists for.
 */
export function claudeCommand({ settingsPath = SETTINGS_PATH, headless = false } = {}) {
  const command = ["claude", "--tools", REVIEW_TOOLS, "--settings", settingsPath];
  if (headless) command.push("--print");
  return command;
}

/**
 * The usage text, built from `REVIEW_MODES` rather than repeating it.
 *
 * A hand-written copy went stale the moment `fallback` was dropped, and advertised a value the
 * parser rejects one line above.
 */
export function usage() {
  return (
    `\nUsage: node ./scripts/agent-review-session.mjs --pr <number> [--mode ${[...REVIEW_MODES].join("|")}]\n` +
    "       [--enforced] [--implementer codex|claude] [--worktree <path>]\n" +
    "       [--focus-file <file>] [--goal-file <file>] [--print-only] [--headless]\n" +
    "       [--pr-json <file>] [--repository <owner/repo>]\n" +
    "\n--headless feeds the prompt to the session on stdin instead of asking someone to paste it,\n" +
    "which is what makes an unattended run possible. Without it the launch is interactive and\n" +
    "requires a TTY. A headless run also publishes the result itself: the session writes nothing,\n" +
    "and the marker is appended only after the worktree check passed. --result-file <path> keeps\n" +
    "that text where you want it.\n" +
    "\nThe result is posted through gh when it is installed, otherwise through the REST API with\n" +
    "GITHUB_TOKEN — the channel the rest of the pipeline uses, and the only one available in a\n" +
    "container without the GitHub CLI. If no channel works, every attempt is reported with its own\n" +
    "reason and the file is left to be posted verbatim.\n" +
    "\n--enforced states that this shell cannot write to the repository (restricted credentials),\n" +
    "which publishes the marker as read-only=true. A launched run without it publishes\n" +
    "read-only=verified: the launcher checks afterwards that the review worktree is untouched.\n" +
    "--print-only hands the prompt to a session this script never observes and stays at\n" +
    "read-only=false, which no merge gate accepts.\n" +
    "\n--pr-json reads the pull-request metadata from a file instead of calling gh, for environments\n" +
    "without the GitHub CLI. Expected keys: number, url, title, body, headRefName, headRefOid,\n" +
    "baseRefName. --repository skips the gh lookup for the repository name.\n" +
    "\nA fallback review — the chosen provider was unavailable — runs as --mode self and is marked\n" +
    "on the pull request with agent:review-fallback."
  );
}

/**
 * The read-only level this invocation can honestly claim.
 *
 * Derived rather than passed, so the marker cannot end up stronger than what the launcher actually
 * does: `--print-only` never sees the session it hands the prompt to, and only `--enforced` says
 * anything about credentials.
 *
 * `verified` additionally requires `headless`, and that condition is the whole point of the level.
 * Only a headless run publishes from the launcher, i.e. *after* the worktree check. An interactive
 * run lets the session post its own comment while it is still running, so the check it would be
 * claiming has not happened yet at publication time — the level would describe an ordering that
 * does not exist. Such a run stays at `false` and writes no marker, exactly as before this level
 * was introduced.
 */
export function readOnlyLevelFor({ enforced, launch, headless }) {
  // `true` is an assertion about credentials, not about ordering: with a token that cannot write,
  // a violating session cannot reach the repository whatever it publishes and whenever.
  if (enforced) return "true";
  return launch && headless ? "verified" : "false";
}

/** Derives `owner/repo` from an origin URL, so the repository name needs no gh call. */
export function repositoryFromRemote(url) {
  const match = String(url ?? "")
    .trim()
    .match(/(?:[:/])([^/:]+)\/([^/]+?)(?:\.git)?\/?$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

/** Fields the launcher needs from the pull request, whatever produced them. */
export const REQUIRED_PR_FIELDS = ["number", "url", "headRefName", "headRefOid", "baseRefName"];

/**
 * Validates externally supplied pull-request metadata.
 *
 * `--pr-json` replaces the one call that used to make the GitHub CLI mandatory, so it has to reject
 * a half-filled file rather than let a missing head SHA reach `git worktree add` as `undefined`.
 */
export function validatePullRequest(pr, source) {
  if (!pr || typeof pr !== "object") {
    throw new Error(`${source} did not contain a pull-request object.`);
  }
  const missing = REQUIRED_PR_FIELDS.filter((field) => !pr[field]);
  if (missing.length > 0) {
    throw new Error(`${source} is missing required field(s): ${missing.join(", ")}.`);
  }
  if (!/^[0-9a-f]{40}$/.test(pr.headRefOid)) {
    throw new Error(`${source} has headRefOid "${pr.headRefOid}", which is not a full 40-char SHA.`);
  }
  return pr;
}

export function parseOptions(argv) {
  const options = {
    pr: null,
    mode: "cross",
    implementer: null,
    launch: true,
    worktree: null,
    focusFile: null,
    goalFile: null,
    prJsonFile: null,
    repository: null,
    // Feed the prompt to the session instead of asking a human to paste it.
    headless: false,
    resultFile: null,
    // Opt-in and never inferred: only the operator knows whether the credentials in this shell can
    // push. Claiming it by default would put the strongest level beyond anyone's control.
    enforced: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[(index += 1)];
    if (arg === "--pr") options.pr = next();
    else if (arg === "--mode") options.mode = next();
    else if (arg === "--implementer") options.implementer = next();
    else if (arg === "--worktree") options.worktree = next();
    else if (arg === "--focus-file") options.focusFile = next();
    else if (arg === "--goal-file") options.goalFile = next();
    else if (arg === "--pr-json") options.prJsonFile = next();
    else if (arg === "--repository") options.repository = next();
    else if (arg === "--print-only") options.launch = false;
    else if (arg === "--headless") options.headless = true;
    else if (arg === "--result-file") options.resultFile = next();
    else if (arg === "--enforced") options.enforced = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  // With `--pr-json` the number is in the file, so demanding it twice would only create a way for
  // the two to disagree.
  if (options.pr !== null && !/^\d+$/.test(options.pr)) {
    throw new Error("--pr <number> is required.");
  }
  if (options.pr === null && !options.prJsonFile) {
    throw new Error("--pr <number> is required.");
  }
  if (!REVIEW_MODES.has(options.mode)) {
    throw new Error(`--mode must be one of ${[...REVIEW_MODES].join(", ")}.`);
  }
  return options;
}

/**
 * Derives the reviewing provider from the implementer and the mode.
 *
 * `cross` is the only mode that switches providers. `self` and `fallback` deliberately stay with
 * the implementation provider and buy their independence from the fresh, read-only session instead.
 */
export function reviewerFor(implementer, mode) {
  if (mode !== "cross") return implementer;
  return implementer === "codex" ? "claude" : "codex";
}

/**
 * The read-only check itself, as a decision over the two facts the launcher gathers.
 *
 * Extracted so the most safety-relevant step in this script can be tested without a live session:
 * it is what `read-only=verified` actually stands for, and it used to be an untested `if` buried in
 * the launch path.
 */
export function detectWorktreeViolation({ dirty, head, expectedSha }) {
  const reasons = [];
  if (dirty) reasons.push(`working tree is dirty:\n${dirty}`);
  // A moved HEAD matters even with a clean tree: a committed change leaves nothing in `git status`,
  // and the verdict is bound to the SHA that was supposed to be reviewed.
  if (head !== expectedSha) reasons.push(`HEAD moved to ${head}.`);
  return { violated: reasons.length > 0, reasons };
}

/**
 * Reads the verdict out of the review text.
 *
 * The launcher needs it to build the marker, and guessing would be worse than refusing: an
 * unreadable verdict must not become a `pass`. Returns null when the line is missing or ambiguous.
 */
export function parseVerdict(output) {
  const found = [
    ...String(output ?? "").matchAll(/^[-*]?\s*Verdikt:\s*`?(pass|changes-required|blocked)`?\s*$/gim),
  ].map((match) => match[1].toLowerCase());
  const distinct = [...new Set(found)];
  // The prompt's own template lists all three as options; a review that left it unedited, or that
  // contradicts itself, is not a verdict the gate should act on.
  return distinct.length === 1 ? distinct[0] : null;
}

/** The marker the launcher appends once the worktree check has passed. */
export function buildResultMarker({ headSha, reviewMode, verdict, sessionId, readOnlyLevel }) {
  return (
    `<!-- agent-pipeline:review-result ${headSha} mode=${reviewMode} ` +
    `verdict=${verdict} session=${sessionId} read-only=${readOnlyLevel} -->`
  );
}

/**
 * Whether this launcher may actually run the review itself, as opposed to only printing its prompt.
 *
 * Two independent reasons it may not, both from the cross-review of 00186da:
 *
 * 1. It starts `claude` unconditionally. Whenever `reviewerFor()` resolves to codex — a Claude
 *    implementation in `cross` mode, or a Codex implementation in `self` mode — launching would run
 *    Claude while the prompt, the session id and the marker all say codex. Nobody is watching an
 *    unattended run to notice.
 * 2. Cross evidence is the counter provider's *native* review approval, which the reconciler reads
 *    from `snapshot.reviews`. Its `cross` branch never looks at an `agent-pipeline:review-result`
 *    comment, so a launched cross run would publish a marker nothing consumes while reporting
 *    success — unusable evidence that looks valid.
 *
 * `--print-only` stays available for every combination: handing the prompt to the right provider's
 * own surface is exactly how a cross review is prepared.
 */
export function launchSupport({ mode, implementer }) {
  const reviewer = reviewerFor(implementer, mode);
  if (reviewer !== "claude") {
    const manualRoute =
      reviewer === "codex" && mode === "self"
        ? "Codex self-review is still supported: use a fresh Codex app task with Settings > " +
          "General > Code review > Detached, start /review for the exact base/head, and complete " +
          "the external worktree verification described in review-session-prompt.md."
        : "Use the provider-specific native review route described in review-session-prompt.md.";
    return {
      ok: false,
      reason:
        `this launcher only runs claude, but ${implementer} in ${mode} mode needs ${reviewer}. ` +
        `Launching would label a claude session as a ${reviewer} review. ${manualRoute}`,
    };
  }
  if (mode !== "self") {
    return {
      ok: false,
      reason:
        `a ${mode} review is evidenced by the counter provider's native approval of the head SHA, ` +
        "not by a review-result marker. The reconciler never reads a marker for this mode, so a " +
        "launched run would publish evidence that cannot satisfy the gate.",
    };
  }
  return { ok: true, reason: null };
}

/**
 * The implementer this run reviews for.
 *
 * One definition, because the launcher and the publisher have to agree: a second, hand-repeated
 * derivation dropped the default and turned a valid publish into a warning that the marker would
 * not be read.
 */
export function implementerFor(options, pr) {
  return options?.implementer ?? implementerFromBranch(pr?.headRefName) ?? "claude";
}

/** Guesses the implementer from the head branch prefix; `--implementer` overrides it. */
export function implementerFromBranch(headBranch) {
  if (headBranch?.startsWith("codex/")) return "codex";
  if (headBranch?.startsWith("claude/")) return "claude";
  return null;
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

function run(command, args, { capture = true, cwd, input } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    input,
    // With `input` the child still needs its output on the terminal, so only stdin is a pipe.
    stdio: capture ? "pipe" : [input === undefined ? "inherit" : "pipe", "inherit", "inherit"],
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (capture && result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout || "").trim()}`,
    );
  }
  return capture ? result.stdout.trim() : result.status;
}

function readPullRequest(options) {
  // The offline path exists because the GitHub CLI is not available everywhere this review needs to
  // run — a Claude Code remote container reaches GitHub through MCP tools and has no `gh` binary at
  // all. Without it the launcher failed before producing even the prompt.
  if (options.prJsonFile) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(options.prJsonFile, "utf8"));
    } catch (error) {
      throw new Error(`Could not read --pr-json ${options.prJsonFile}.\n${error.message}`);
    }
    const pr = validatePullRequest(parsed, `--pr-json ${options.prJsonFile}`);

    // The file says which pull request this is; nothing in it proves the fields belong together.
    // Where gh exists, ask GitHub and refuse a mismatch — a review bound to the wrong number or SHA
    // is worse than no review, because its marker looks exactly like a valid one.
    let authoritative = null;
    try {
      authoritative = JSON.parse(
        run("gh", ["pr", "view", String(pr.number), "--json", "headRefOid,headRefName,baseRefName"]),
      );
    } catch {
      console.warn(
        "Note: gh is unavailable, so the --pr-json metadata could not be checked against GitHub.\n" +
          "      Head SHA, branch and pull-request number are taken on trust from the file.",
      );
    }
    if (authoritative) {
      const mismatches = ["headRefOid", "headRefName", "baseRefName"].filter(
        (field) => authoritative[field] && authoritative[field] !== pr[field],
      );
      if (mismatches.length > 0) {
        throw new Error(
          `--pr-json disagrees with GitHub for pull request #${pr.number} on: ` +
            `${mismatches.map((f) => `${f} (file ${pr[f]}, GitHub ${authoritative[f]})`).join("; ")}.`,
        );
      }
    }
    return pr;
  }

  const fields = "number,url,title,body,headRefName,headRefOid,baseRefName,isDraft";
  try {
    return validatePullRequest(
      JSON.parse(run("gh", ["pr", "view", options.pr, "--json", fields])),
      `gh pr view ${options.pr}`,
    );
  } catch (error) {
    throw new Error(
      `Could not read pull request #${options.pr} via gh. Is the GitHub CLI installed and ` +
        `authenticated? Without it, pass the metadata directly with --pr-json <file>.\n${error.message}`,
    );
  }
}

/** Repository name from `--repository`, else gh, else the origin remote. */
function resolveRepository(options) {
  if (options.repository) return options.repository;
  try {
    return run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
  } catch {
    // No gh here. The origin URL carries the same information and needs no network call.
    const fromRemote = repositoryFromRemote(
      (() => {
        try {
          return run("git", ["remote", "get-url", "origin"]);
        } catch {
          return null;
        }
      })(),
    );
    if (fromRemote) return fromRemote;
    throw new Error(
      "Could not determine the repository. Pass --repository <owner/repo>, or run where gh or an " +
        "origin remote is available.",
    );
  }
}

/**
 * Pulls the goal out of the pull-request body.
 *
 * Falls back to the title: an invented goal would be worse than a thin one, because the reviewer
 * would measure the diff against something nobody asked for.
 */
export function goalFromBody(body, title) {
  // `(?![\s\S])` is the end-of-input anchor. JavaScript has no `\Z`: written there it is an
  // identity escape matching a literal "Z", so with a lazy body the section ended at the first
  // capital Z in the text — which German goal descriptions almost always contain ("Ziel",
  // "Zustand", "Zugriff"). The reviewer then measured the diff against half its acceptance
  // criteria, or against the bare title, and nothing said so.
  const match = body?.match(/^##\s*Ziel\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m);
  const section = match?.[1]
    ?.replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  return section || title || "Im Pull Request beschrieben; siehe Titel und Beschreibung.";
}

async function main(argv) {
  const options = parseOptions(argv);
  // Before any side effect: an interactive launch waits for a keyboard that is not there, and would
  // otherwise hang after already creating a worktree the operator then has to clean up.
  if (options.launch && !options.headless && !process.stdin.isTTY) {
    throw new Error(
      "Interactive launch needs a terminal, and this shell has no TTY.\n" +
        "Use --headless to feed the prompt to the session, or --print-only to get it as a file.",
    );
  }
  const pr = readPullRequest(options);
  const repository = resolveRepository(options);
  const readOnlyLevel = readOnlyLevelFor(options);
  if (options.launch && !options.headless && !options.enforced) {
    // Say it before the run rather than leaving the operator to notice a missing marker afterwards.
    console.warn(
      "Note: an interactive run publishes from the session itself, before the worktree check.\n" +
        "      It therefore stays at read-only=false and writes no marker. Use --headless for a\n" +
        "      gate-eligible review, or --enforced if credentials cannot write.",
    );
  }

  const implementer = implementerFor(options, pr);
  // Before the worktree exists, so a rejected combination leaves nothing to clean up.
  const support = launchSupport({ mode: options.mode, implementer });
  if (options.launch && !support.ok) {
    throw new Error(
      `Cannot launch this review: ${support.reason}\n` +
        "Use --print-only to prepare the provider-specific manual route without launching Claude.",
    );
  }
  // Nothing so far guarantees the head exists locally, and a review session is meant to start from
  // a clean clone. Without this, `merge-base` below fails with "not a valid commit name" — before
  // any error path that could explain what to do about it.
  try {
    run("git", ["fetch", "origin", pr.headRefName, pr.baseRefName]);
  } catch (error) {
    throw new Error(
      `Could not fetch ${pr.headRefName} and ${pr.baseRefName} from origin.\n${error.message}`,
    );
  }

  const baseSha = run("git", ["merge-base", `origin/${pr.baseRefName}`, pr.headRefOid]);
  const sessionId = `${implementer}-review-${pr.headRefOid.slice(0, 7)}-${Date.now().toString(36)}`;

  const worktree = resolve(
    options.worktree ?? join(process.cwd(), "..", `review-pr-${pr.number}`),
  );
  // Detached at the exact SHA: a push to the branch during the review must not move the code out
  // from under the verdict, which is bound to this SHA.
  try {
    run("git", ["worktree", "add", "--detach", worktree, pr.headRefOid]);
  } catch (error) {
    // Usually a worktree an aborted earlier run left registered. Say what to do rather than making
    // the operator decode git's message.
    throw new Error(
      `Could not create the review worktree at ${worktree}.\n` +
        `If an earlier run left one behind: git worktree remove --force ${worktree}\n` +
        `Or pick another path with --worktree.\n${error.message}`,
    );
  }

  const prompt = renderReviewPrompt({
    repository,
    pullNumber: pr.number,
    pullUrl: pr.url,
    baseBranch: pr.baseRefName,
    baseSha,
    headBranch: pr.headRefName,
    headSha: pr.headRefOid,
    implementer,
    reviewerProvider: reviewerFor(implementer, options.mode),
    reviewMode: options.mode,
    sessionId,
    readOnlyLevel,
    publisher: options.headless ? "launcher" : "session",
    taskGoal: options.goalFile
      ? readFileSync(options.goalFile, "utf8").trim()
      : goalFromBody(pr.body, pr.title),
    focus: options.focusFile
      ? readFileSync(options.focusFile, "utf8").trim()
      : DEFAULT_FOCUS,
  });

  // Outside the worktree on purpose: a prompt file inside it would show up as an untracked change
  // and defeat the very check that proves the session wrote nothing.
  const promptPath = join(mkdtempSync(join(tmpdir(), "agent-review-")), `pr-${pr.number}.md`);
  writeFileSync(promptPath, prompt, "utf8");

  const command = claudeCommand({ headless: options.headless });
  console.log(`Pull request : #${pr.number} ${pr.title}`);
  console.log(`Head SHA     : ${pr.headRefOid}`);
  console.log(`Mode         : ${options.mode} (${implementer} → ${reviewerFor(implementer, options.mode)})`);
  console.log(`Worktree     : ${worktree}`);
  console.log(`Prompt       : ${promptPath}`);
  // Printing a `claude …` line for a review that codex has to run would be the same mislabeling in
  // the console that the launch guard prevents in the session.
  console.log(
    support.ok
      ? `Command      : ${command.join(" ")}`
      : `Command      : none — ${support.reason}`,
  );
  console.log(
    `Read-only    : ${
      readOnlyLevel === "true"
        ? "true — asserted via --enforced; credentials cannot write to the code"
        : readOnlyLevel === "verified"
          ? "verified — tools removed, writing git/gh denied, worktree checked after the session (pass --enforced once credentials cannot push)"
          : "false — this run hands the prompt to a session it never observes; the prompt forbids the marker"
    }`,
  );
  console.log("");

  if (!options.launch) {
    console.log("--print-only: nothing was launched. Paste the prompt file into the session above.");
    console.log(`Clean up with: git worktree remove ${worktree}`);
    return;
  }

  let reviewText = null;
  if (options.headless) {
    console.log("Running the review session headless; the prompt is fed in on stdin.\n");
    // Captured rather than inherited: the launcher publishes the result itself, which is the only
    // way the marker can be written *after* the worktree check instead of before it.
    reviewText = run(command[0], command.slice(1), { cwd: worktree, input: prompt });
    console.log(reviewText);
  } else {
    console.log("Starting the review session. Paste the prompt above into it.\n");
    run(command[0], command.slice(1), { capture: false, cwd: worktree });
  }

  // A detector, not a preventer: it runs after the session ended, so a violating session has
  // already done whatever it did. It also only sees this worktree — writes elsewhere are invisible.
  // Worth having anyway, because the failure it catches is the likely one: a reviewer that helpfully
  // fixed what it found and then reported a pass on its own repair.
  const dirty = run("git", ["status", "--porcelain"], { cwd: worktree });
  const head = run("git", ["rev-parse", "HEAD"], { cwd: worktree });
  console.log("");
  const violation = detectWorktreeViolation({ dirty, head, expectedSha: pr.headRefOid });
  if (violation.violated) {
    console.error("READ-ONLY VIOLATED: the review session changed its worktree.");
    for (const reason of violation.reasons) console.error(reason);
    console.error("Treat the review as invalid.");
    if (reviewText !== null) {
      // The whole point of publishing from here: nothing was written to the pull request, so there
      // is no marker to race the reconciler for.
      console.error("Nothing was published; the result is discarded.");
    } else {
      console.error(
        `Delete any agent-pipeline:review-result marker for ${pr.headRefOid} from pull request #${pr.number} now:\n` +
          "the reconciler runs on a schedule and would read it as a passing review.",
      );
    }
    process.exitCode = 1;
    return;
  }
  console.log(`Worktree unchanged at ${pr.headRefOid}; no write reached the reviewed code.`);
  if (readOnlyLevel === "verified") {
    console.log("This check is what read-only=verified stands for; the marker is now backed by it.");
  }

  if (reviewText !== null) {
    await publishResult({ pr, options, repository, implementer, reviewText, readOnlyLevel, sessionId });
  }
  console.log(`Clean up with: git worktree remove ${worktree}`);
}

/** Posts a comment through the REST API, the channel the rest of the pipeline already uses. */
async function postCommentViaApi({ repository, pullNumber, body, token }) {
  const base = process.env.GITHUB_API_URL ?? "https://api.github.com";
  const response = await fetch(`${base}/repos/${repository}/issues/${pullNumber}/comments`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body }),
  });
  if (!response.ok) {
    throw new Error(`GitHub API responded ${response.status}: ${(await response.text()).trim()}`);
  }
  return response.json();
}

function runGhComment({ pullNumber, resultPath }) {
  run("gh", ["pr", "comment", String(pullNumber), "--body-file", resultPath]);
}

/** Why an attempt failed, distinguishing an absent tool from one that ran and refused. */
function publishFailureReason(error) {
  if (error?.code === "ENOENT") return "gh is not installed here";
  return error instanceof Error ? error.message : String(error);
}

/**
 * Posts the review, trying every channel this environment actually has.
 *
 * `gh` first, so an operator's authenticated shell behaves exactly as before. The REST API second,
 * because a Claude Code remote container has no `gh` binary at all — the same environment `--pr-json`
 * already exists for on the reading side. Without this the write side was the one step of the whole
 * self-review that could not complete on its own, and every failure was reported as "gh is
 * unavailable" even when gh had run and been refused.
 *
 * Never throws: a review that was produced must not be lost because posting it failed. The caller
 * reports every attempt with its real reason and points at the file.
 */
export async function publishComment(
  { repository, pullNumber, resultPath, body, token },
  { gh = runGhComment, api = postCommentViaApi } = {},
) {
  const attempts = [];
  try {
    gh({ pullNumber, resultPath });
    return { posted: true, channel: "gh", attempts };
  } catch (error) {
    attempts.push({ channel: "gh", reason: publishFailureReason(error) });
  }

  if (!token) {
    attempts.push({ channel: "api", reason: "GITHUB_TOKEN is not set" });
    return { posted: false, attempts };
  }
  if (!repository) {
    attempts.push({ channel: "api", reason: "the repository could not be resolved" });
    return { posted: false, attempts };
  }
  try {
    const comment = await api({ repository, pullNumber, body, token });
    return {
      posted: true,
      channel: "api",
      url: comment?.html_url ?? null,
      author: comment?.user?.login ?? null,
      attempts,
    };
  } catch (error) {
    attempts.push({ channel: "api", reason: publishFailureReason(error) });
  }
  return { posted: false, attempts };
}

/**
 * Whether the identity that posted the marker is one the merge gate accepts for this review.
 *
 * A marker from any other account is not rejected loudly by the reconciler — it is simply not read,
 * which looks exactly like a review that never happened. Saying so at publication time is the only
 * moment anyone is watching.
 */
export function markerAuthorAccepted(author, reviewer, config = loadConfig()) {
  if (!author) return true;
  return (config.providerAuthorAllowlist?.[reviewer] ?? []).includes(author);
}

/**
 * Writes the review out and posts it, now that the worktree check has passed.
 *
 * Publishing is best-effort by design: where no channel works the result is still written to a file
 * with the marker already appended, so the operator — or the session driving this script — can post
 * it verbatim. Failing to post must not lose the review.
 */
async function publishResult({ pr, options, repository, implementer, reviewText, readOnlyLevel, sessionId }) {
  const verdict = parseVerdict(reviewText);
  const body =
    verdict === null
      ? reviewText
      : `${reviewText.trimEnd()}\n\n${buildResultMarker({
          headSha: pr.headRefOid,
          reviewMode: options.mode,
          verdict,
          sessionId,
          readOnlyLevel,
        })}\n`;

  const resultPath =
    options.resultFile ??
    join(mkdtempSync(join(tmpdir(), "agent-review-result-")), `pr-${pr.number}-result.md`);
  writeFileSync(resultPath, body, "utf8");
  console.log(`\nResult       : ${resultPath}`);

  if (verdict === null) {
    console.error(
      "No unambiguous `Verdikt:` line in the review output — no marker was appended.\n" +
        "Read the result and decide manually; a guessed verdict must never reach the gate.",
    );
    process.exitCode = 1;
    return;
  }
  console.log(`Verdict      : ${verdict}`);

  const outcome = await publishComment({
    repository,
    pullNumber: pr.number,
    resultPath,
    body,
    token: process.env.GITHUB_TOKEN,
  });

  if (!outcome.posted) {
    console.log(
      `Published    : not posted — no channel worked.\n` +
        outcome.attempts.map((a) => `               ${a.channel}: ${a.reason}\n`).join("") +
        `               Post the file above verbatim as a comment on pull request #${pr.number};\n` +
        `               it already carries the marker the merge gate reads.`,
    );
    return;
  }

  console.log(
    `Published    : comment posted to pull request #${pr.number} via ${outcome.channel}` +
      `${outcome.url ? ` (${outcome.url})` : ""}.`,
  );
  for (const attempt of outcome.attempts) {
    console.log(`               ${attempt.channel} was tried first: ${attempt.reason}`);
  }
  // Only the API path reports who GitHub recorded as the author; gh posts as whoever it is logged
  // in as, which this script cannot see.
  const reviewer = reviewerFor(implementer, options.mode);
  if (outcome.author && !markerAuthorAccepted(outcome.author, reviewer)) {
    console.error(
      `WARNING: the comment was posted as ${outcome.author}, which is not in ` +
        `providerAuthorAllowlist.${reviewer}. The reconciler will not read this marker, and the ` +
        "pull request will look like it was never reviewed. Post it again from an allowed identity.",
    );
    process.exitCode = 1;
  }
}

const isMainModule =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  }
}
