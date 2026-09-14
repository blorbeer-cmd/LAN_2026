// Runs the visual reference owners in the pinned Linux container built from
// server/visual-reference/Dockerfile. Local runs and CI use this same image, so a reference image
// is always compared under the environment it was created in (see server/TESTING.md).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E_VISUAL_FILES, selectedE2EFiles } from '../../scripts/e2e-partitions.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(scriptDir, '..');
const repositoryDir = path.resolve(serverDir, '..');
const dockerfile = path.join(serverDir, 'visual-reference', 'Dockerfile');
const IMAGE_INPUTS = [
  'visual-reference/Dockerfile',
  'visual-reference/Dockerfile.dockerignore',
  'package.json',
  'package-lock.json',
];
// Only these variables cross into the container; host runner details would misdescribe it.
const FORWARDED_ENV = ['NODE_ENV', 'E2E_FAST_TIMERS', 'E2E_TRACE', 'CI', 'GITHUB_ACTIONS', 'GITHUB_RUN_ID', 'GITHUB_SHA'];

export const VISUAL_REFERENCE_PLATFORM = 'linux/amd64';
export const VISUAL_REFERENCE_SETUP_HINT =
  'Einrichtung: Docker Desktop (Windows/macOS, Linux-Container) bzw. Docker Engine (Linux) installieren '
  + 'und starten; Details in server/TESTING.md unter „Visuelle Referenzen“.';

// Local image cache key. Line endings differ between Windows and Linux checkouts only.
export function visualReferenceImageTag(readFile = (file) => readFileSync(file, 'utf8')) {
  const hash = createHash('sha256');
  for (const file of IMAGE_INPUTS) {
    hash.update(`${file}\0${readFile(path.join(serverDir, file)).replace(/\r\n/g, '\n')}\0`);
  }
  return `respawn-visual-reference:${hash.digest('hex').slice(0, 16)}`;
}

export function dockerStatus(run = spawnSync) {
  const result = run('docker', ['version', '--format', '{{.Server.Os}}/{{.Server.Arch}}'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
  });
  if (result.error) {
    return {
      ok: false,
      reason: result.error.code === 'ENOENT'
        ? 'Docker-CLI nicht gefunden'
        : `Docker nicht erreichbar (${result.error.message})`,
    };
  }
  const server = `${result.stdout ?? ''}`.trim();
  if (result.status !== 0 || !/^[a-z]+\/[a-z0-9]+$/.test(server)) {
    const detail = `${result.stderr ?? ''}`.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    return { ok: false, reason: `Docker-Engine nicht erreichbar${detail ? ` (${detail})` : ''}` };
  }
  if (!server.startsWith('linux/')) {
    return { ok: false, reason: `Docker läuft mit ${server}-Containern; benötigt werden Linux-Container` };
  }
  return { ok: true, server };
}

export function ensureVisualReferenceImage({
  run = spawnSync,
  log = console.log,
  tag = visualReferenceImageTag(),
} = {}) {
  const inspect = run('docker', ['image', 'inspect', '--format', '{{.Os}}/{{.Architecture}}', tag], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (inspect.status === 0 && `${inspect.stdout}`.trim() === VISUAL_REFERENCE_PLATFORM) return tag;
  log(`[e2e visual] Referenzumgebung ${tag} wird gebaut (einmal je Stand von Dockerfile und Lockfile) …`);
  const build = run(
    'docker',
    ['build', '--platform', VISUAL_REFERENCE_PLATFORM, '--file', dockerfile, '--tag', tag, serverDir],
    { stdio: 'inherit', windowsHide: true },
  );
  if (build.error || build.status !== 0) {
    throw new Error(
      `Referenzumgebung konnte nicht gebaut werden (docker build: ${build.error?.message ?? `Exit ${build.status}`})`,
    );
  }
  return tag;
}

export function visualContainerArguments({ tag, files, artifactDirectory, env = process.env }) {
  const forwarded = FORWARDED_ENV
    .filter((name) => env[name] !== undefined)
    .flatMap((name) => ['--env', `${name}=${env[name]}`]);
  return [
    'run', '--rm', '--init', '--ipc=host', '--platform', VISUAL_REFERENCE_PLATFORM,
    // Read-only checkout: a normal run can never create or change a reference image.
    '--mount', `type=bind,source=${repositoryDir},target=/work,readonly`,
    // Anonymous volume seeded from the image, so the host's node_modules is never used.
    '--mount', 'type=volume,target=/work/server/node_modules',
    '--mount', `type=bind,source=${artifactDirectory},target=/artifacts`,
    '--workdir', '/work/server',
    ...forwarded,
    '--env', 'E2E_ARTIFACT_DIR=/artifacts',
    tag,
    'node', '--import', './scripts/e2e-owner-diagnostics.mjs', '--test', '--test-concurrency=6',
    ...files.map((file) => `dist-test/test/e2e/${file.replace(/\.ts$/, '.js')}`),
  ];
}

export function runVisualOwnersInContainer({
  files,
  artifactDirectory,
  env = process.env,
  run = spawnSync,
  log = console.log,
  fileExists = existsSync,
}) {
  if (!fileExists(path.join(serverDir, 'node_modules'))) {
    throw new Error('server/node_modules fehlt; zuerst die Server-Abhängigkeiten installieren');
  }
  const tag = ensureVisualReferenceImage({ run, log });
  log(`[e2e visual] ${files.join(', ')} laufen in ${tag}`);
  const result = run('docker', visualContainerArguments({ tag, files, artifactDirectory, env }), {
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

export function visualFilesForSelection(partition, coreSelection = 'all') {
  return selectedE2EFiles(partition, coreSelection).filter((file) => E2E_VISUAL_FILES.includes(file));
}

// CI prepares the image in an unmeasured step, so the measured test step only starts containers.
function main(argv = process.argv.slice(2)) {
  const [command, partition = 'all', coreSelection = 'all'] = argv;
  if (command !== 'prepare') {
    throw new Error('Aufruf: node scripts/visual-reference.mjs prepare [partition] [core-auswahl]');
  }
  const files = visualFilesForSelection(partition, coreSelection);
  if (files.length === 0) {
    console.log(`[e2e visual] Auswahl ${partition}/${coreSelection} enthält keine visuellen Referenztests.`);
    return;
  }
  const docker = dockerStatus();
  if (!docker.ok) throw new Error(`${docker.reason}. ${VISUAL_REFERENCE_SETUP_HINT}`);
  console.log(`[e2e visual] Referenzumgebung bereit: ${ensureVisualReferenceImage()}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
