import path from "node:path";

export const CORE_E2E_DOMAINS = Object.freeze({
  auth: Object.freeze(["access.e2e.test.ts", "authGate.e2e.test.ts"]),
  checklist: Object.freeze(["checklist.e2e.test.ts"]),
  invitations: Object.freeze(["eventInvitations.e2e.test.ts", "eventWorkspaceSwitch.e2e.test.ts"]),
  flows: Object.freeze([
    "flowsCompetition.e2e.test.ts",
    "flowsCommunity.e2e.test.ts",
    "flowsShell.e2e.test.ts",
    "phase5eIsolation.e2e.test.ts",
  ]),
});

export const CORE_E2E_DOMAIN_ORDER = Object.freeze(Object.keys(CORE_E2E_DOMAINS));

// Shared fixture modules are not executable test entry points and therefore stay outside the
// validated partition lists. They still need explicit ownership so path-based CI selection can
// classify a fixture-only change as narrowly as the wrappers that import it.
export const E2E_SUPPORT_FILES = Object.freeze({
  core: Object.freeze({
    "flows.fixture.ts": "flows",
  }),
  arcade: Object.freeze([
    "arcade.fixture.ts",
    "arcadeFlows.fixture.ts",
    "challengeRush.fixture.ts",
  ]),
});

// Single machine-readable source for every browser suite. The partition runner validates this
// registry against the source directory before every run; the path classifier consumes the same
// entries, so neither side can silently invent a different Core/Arcade assignment.
export const E2E_MANIFEST = Object.freeze({
  partitions: Object.freeze({
    core: Object.freeze(Object.values(CORE_E2E_DOMAINS).flat()),
    arcade: Object.freeze([
      "challengeRushLifecycle.e2e.test.ts",
      "snakeArenaViews.e2e.test.ts",
      "challengeRush.e2e.test.ts",
      "battleship.e2e.test.ts",
      "arcadeFlows.e2e.test.ts",
      "arcade.e2e.test.ts",
      "arcadeMultiplayer.e2e.test.ts",
      "arcadeScribbleViews.e2e.test.ts",
      "arcadeSmoke.e2e.test.ts",
      "arcadeStreamRenderer.e2e.test.ts",
      "authGateArcade.e2e.test.ts",
    ]),
  }),
  smoke: Object.freeze(["arcadeSmoke.e2e.test.ts", "authGateArcade.e2e.test.ts"]),
});

export const E2E_PARTITIONS = E2E_MANIFEST.partitions;
export const E2E_SMOKE_FILES = E2E_MANIFEST.smoke;

export function validateE2EManifest(sourceFiles, manifest = E2E_MANIFEST) {
  const assignments = new Map();
  for (const [partition, files] of Object.entries(manifest.partitions ?? {})) {
    for (const file of files ?? []) {
      const owners = assignments.get(file) ?? [];
      owners.push(partition);
      assignments.set(file, owners);
    }
  }

  const duplicates = [...assignments.entries()]
    .filter(([, owners]) => owners.length !== 1)
    .map(([file, owners]) => `${file} (${owners.join(", ")})`);
  const missing = sourceFiles.filter((file) => !assignments.has(file));
  const absent = [...assignments.keys()].filter((file) => !sourceFiles.includes(file));
  const invalidSmoke = (manifest.smoke ?? []).filter(
    (file) => !manifest.partitions?.arcade?.includes(file),
  );

  if (duplicates.length || missing.length || absent.length || invalidSmoke.length) {
    const details = [
      duplicates.length ? `mehrfach zugeordnet: ${duplicates.join(", ")}` : "",
      missing.length ? `nicht zugeordnet: ${missing.join(", ")}` : "",
      absent.length ? `nicht vorhanden: ${absent.join(", ")}` : "",
      invalidSmoke.length
        ? `Smoke-Dateien außerhalb von Arcade: ${invalidSmoke.join(", ")}`
        : "",
    ].filter(Boolean);
    throw new Error(`Ungültiges E2E-Manifest – ${details.join("; ")}`);
  }
}

export function mainPartitionForE2EPath(file) {
  const name = path.posix.basename(String(file).replaceAll("\\", "/"));
  for (const [partition, files] of Object.entries(E2E_PARTITIONS)) {
    if (files.includes(name)) return partition;
  }
  if (Object.hasOwn(E2E_SUPPORT_FILES.core, name)) return "core";
  if (E2E_SUPPORT_FILES.arcade.includes(name)) return "arcade";
  return null;
}

export function coreDomainForE2EPath(file) {
  const name = path.posix.basename(String(file).replaceAll("\\", "/"));
  for (const [domain, files] of Object.entries(CORE_E2E_DOMAINS)) {
    if (files.includes(name)) return domain;
  }
  return E2E_SUPPORT_FILES.core[name] ?? null;
}

export function selectedCoreDomains(selection = "all") {
  if (selection === "all") return [...CORE_E2E_DOMAIN_ORDER];
  const requested = [...new Set(selection.split(",").map((value) => value.trim()).filter(Boolean))];
  const unknown = requested.filter((domain) => !Object.hasOwn(CORE_E2E_DOMAINS, domain));
  if (!requested.length || unknown.length) {
    throw new Error(`Ungültige Core-E2E-Auswahl: ${selection || "(leer)"}`);
  }
  return CORE_E2E_DOMAIN_ORDER.filter((domain) => requested.includes(domain));
}

export function selectedE2EFiles(partition, coreSelection = "all") {
  if (partition === "all") return [...E2E_PARTITIONS.core, ...E2E_PARTITIONS.arcade];
  if (partition === "arcade-smoke") return [...E2E_SMOKE_FILES];
  if (partition === "core") {
    return selectedCoreDomains(coreSelection).flatMap((domain) => CORE_E2E_DOMAINS[domain]);
  }
  const files = E2E_PARTITIONS[partition];
  if (!files) throw new Error(`Unbekannte E2E-Partition: ${partition}`);
  return [...files];
}
