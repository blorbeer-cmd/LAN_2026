import path from "node:path";

// Single machine-readable source for every browser suite. The partition runner validates this
// registry against the source directory before every run; the path classifier consumes the same
// entries, so neither side can silently invent a different Core/Arcade assignment.
export const E2E_MANIFEST = Object.freeze({
  partitions: Object.freeze({
    core: Object.freeze([
      "access.e2e.test.ts",
      "authGate.e2e.test.ts",
      "checklist.e2e.test.ts",
      "eventInvitations.e2e.test.ts",
      "flows.e2e.test.ts",
      "phase5eIsolation.e2e.test.ts",
    ]),
    arcade: Object.freeze([
      "arcade.e2e.test.ts",
      "arcadeStreamRenderer.e2e.test.ts",
      "authGateArcade.e2e.test.ts",
      "battleship.e2e.test.ts",
      "challengeRush.e2e.test.ts",
      "arcadeFlows.e2e.test.ts",
    ]),
  }),
  smoke: Object.freeze([
    "arcade.e2e.test.ts",
    "authGateArcade.e2e.test.ts",
  ]),
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
  return null;
}

export function selectedE2EFiles(partition) {
  if (partition === "all") return [...E2E_PARTITIONS.core, ...E2E_PARTITIONS.arcade];
  if (partition === "arcade-smoke") return [...E2E_SMOKE_FILES];
  const files = E2E_PARTITIONS[partition];
  if (!files) throw new Error(`Unbekannte E2E-Partition: ${partition}`);
  return [...files];
}
