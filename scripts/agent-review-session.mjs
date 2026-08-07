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
// review-result marker may already be posted. So `read_only_enforced: true` is not asserted here.
// `--enforced` is how the operator states they put that layer in place; without it the generated
// prompt forbids the marker, and the review counts as input for a human rather than for the gate.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  readOnlyEnforced,
  taskGoal,
  focus,
}) {
  const enforcement = readOnlyEnforced
    ? "ja — Editierwerkzeuge sind der Session entzogen, schreibende git- und gh-Befehle sind per Deny-Regel gesperrt, die Credentials haben kein Code-Schreibrecht, und der Arbeitsbaum wird nach der Session von außen geprüft"
    : "nein — Editierwerkzeuge sind zwar entzogen und schreibende git-/gh-Befehle gesperrt, aber ohne eingeschränkte Credentials bleibt eine Shell eine breite Oberfläche";

  const marker = readOnlyEnforced
    ? [
        "Schreibe als letzte Zeile des Kommentars zusätzlich diesen Marker, damit das Merge-Gate das",
        "Review sehen kann:",
        "",
        `<!-- agent-pipeline:review-result ${headSha} mode=${reviewMode} verdict=<pass|changes-required|blocked> session=${sessionId} read-only=true -->`,
        "",
        "Setze `verdict` auf denselben Wert wie oben. Schreibe den Marker nicht, wenn du oben mit",
        "`blocked` abgebrochen hast, weil Identität oder Head-SHA nicht stimmten.",
      ].join("\n")
    : [
        "Schreibe KEINEN `<!-- agent-pipeline:review-result ... -->`-Marker. Read-only ist hier nicht",
        "erzwungen; der Marker würde dem Merge-Gate ein Review vortäuschen, dessen Voraussetzung",
        "fehlt. Dieses Review dient dann als inhaltliche Prüfung für den Nutzer.",
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
Read-only technisch erzwungen: ${enforcement}

Ziel und Abnahmekriterien des geprüften Auftrags:
${taskGoal}

Regeln für diese Session:

1. Dies ist ausschließlich ein Review. Ändere keine Datei, erstelle keinen Commit, pushe nichts,
   approviere und merge den PR nicht, löse keine Review-Threads auf und setze oder entferne kein
   Label. Die einzige erlaubte Schreiboperation ist genau ein Kommentar am Pull Request mit deinem
   Ergebnis.
   Prüfe zu Beginn und am Ende \`git status --porcelain\` und nenne beide Ergebnisse im Kommentar.
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

Ergebnis veröffentlichen:

Poste genau einen Kommentar an Pull Request #${pullNumber} mit diesem Aufbau:

## Review-Ergebnis (${reviewerProvider}, separate Session, Modus ${reviewMode})

- Geprüfter Head-SHA: ${headSha}
- Review-Session-ID: ${sessionId}
- Read-only technisch erzwungen: ${readOnlyEnforced ? "ja" : "nein"}
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

/** `claude` invocation that makes the session read-only from the outside. */
export function claudeCommand({ settingsPath = SETTINGS_PATH } = {}) {
  return ["claude", "--tools", REVIEW_TOOLS, "--settings", settingsPath];
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
    // Opt-in and never inferred: only the operator knows whether the credentials in this shell can
    // push. Claiming it by default would put the one flag the gate checks beyond anyone's control.
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
    else if (arg === "--print-only") options.launch = false;
    else if (arg === "--enforced") options.enforced = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (!options.pr || !/^\d+$/.test(options.pr)) {
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

/** Guesses the implementer from the head branch prefix; `--implementer` overrides it. */
export function implementerFromBranch(headBranch) {
  if (headBranch?.startsWith("codex/")) return "codex";
  if (headBranch?.startsWith("claude/")) return "claude";
  return null;
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

function run(command, args, { capture = true, cwd } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
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

function readPullRequest(pr) {
  const fields = "number,url,title,body,headRefName,headRefOid,baseRefName,isDraft";
  try {
    return JSON.parse(run("gh", ["pr", "view", pr, "--json", fields]));
  } catch (error) {
    throw new Error(
      `Could not read pull request #${pr} via gh. Is the GitHub CLI installed and authenticated?\n${error.message}`,
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
  const match = body?.match(/^##\s*Ziel\s*$([\s\S]*?)(?=^##\s|\Z)/m);
  const section = match?.[1]
    ?.replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  return section || title || "Im Pull Request beschrieben; siehe Titel und Beschreibung.";
}

function main(argv) {
  const options = parseOptions(argv);
  const pr = readPullRequest(options.pr);
  const repository = run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);

  const implementer =
    options.implementer ?? implementerFromBranch(pr.headRefName) ?? "claude";
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
    readOnlyEnforced: options.enforced,
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

  const command = claudeCommand();
  console.log(`Pull request : #${pr.number} ${pr.title}`);
  console.log(`Head SHA     : ${pr.headRefOid}`);
  console.log(`Mode         : ${options.mode} (${implementer} → ${reviewerFor(implementer, options.mode)})`);
  console.log(`Worktree     : ${worktree}`);
  console.log(`Prompt       : ${promptPath}`);
  console.log(`Command      : ${command.join(" ")}`);
  console.log(
    `Read-only    : ${
      options.enforced
        ? "asserted via --enforced; the prompt permits the merge-gate marker"
        : "tools removed and writing git/gh denied, but not asserted — the prompt forbids the marker (pass --enforced once credentials cannot push)"
    }`,
  );
  console.log("");

  if (!options.launch) {
    console.log("--print-only: nothing was launched. Paste the prompt file into the session above.");
    console.log(`Clean up with: git worktree remove ${worktree}`);
    return;
  }

  console.log("Starting the review session. Paste the prompt above into it.\n");
  run(command[0], command.slice(1), { capture: false, cwd: worktree });

  // A detector, not a preventer: it runs after the session ended, so a violating session has
  // already done whatever it did. It also only sees this worktree — writes elsewhere are invisible.
  // Worth having anyway, because the failure it catches is the likely one: a reviewer that helpfully
  // fixed what it found and then reported a pass on its own repair.
  const dirty = run("git", ["status", "--porcelain"], { cwd: worktree });
  const head = run("git", ["rev-parse", "HEAD"], { cwd: worktree });
  console.log("");
  if (dirty || head !== pr.headRefOid) {
    console.error("READ-ONLY VIOLATED: the review session changed its worktree.");
    if (dirty) console.error(dirty);
    if (head !== pr.headRefOid) console.error(`HEAD moved to ${head}.`);
    console.error("Treat the review as invalid.");
    if (options.enforced) {
      console.error(
        `Delete any agent-pipeline:review-result marker for ${pr.headRefOid} from pull request #${pr.number} now:\n` +
          "the reconciler runs on a schedule and would read it as a passing review.",
      );
    }
    process.exitCode = 1;
    return;
  }
  console.log(`Worktree unchanged at ${pr.headRefOid}; no write reached the reviewed code.`);
  console.log(`Clean up with: git worktree remove ${worktree}`);
}

const isMainModule =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(
      "\nUsage: node ./scripts/agent-review-session.mjs --pr <number> [--mode cross|self|fallback]\n" +
        "       [--implementer codex|claude] [--worktree <path>] [--focus-file <file>] [--goal-file <file>] [--print-only]",
    );
    process.exitCode = 1;
  }
}
