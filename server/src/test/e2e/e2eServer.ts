import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import path from 'node:path';

export interface E2EServerDiagnostics {
  output: string;
  exit: { code: number | null; signal: NodeJS.Signals | null } | null;
}

export interface E2EServer {
  process: ChildProcess;
  baseUrl: string;
  port: number;
  diagnostics: () => E2EServerDiagnostics;
}

function openServerLog(child: ChildProcess): WriteStream | null {
  const artifactDir = process.env.E2E_ARTIFACT_DIR;
  if (!artifactDir) return null;
  mkdirSync(artifactDir, { recursive: true });
  const stream = createWriteStream(path.join(artifactDir, `server-${child.pid ?? process.pid}.log`), {
    flags: 'a',
  });
  // Diagnostics must never turn a passing test into a failure, for example
  // when an ephemeral CI runner runs out of artifact disk space.
  stream.on('error', () => undefined);
  return stream;
}

export function startE2EServer(env: NodeJS.ProcessEnv, timeoutMs = 10_000): Promise<E2EServer> {
  const child = spawn('node', [path.join(__dirname, '..', '..', '..', 'dist', 'index.js')], {
    env: { ...env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const serverLog = openServerLog(child);

  return new Promise((resolve, reject) => {
    let output = '';
    let settled = false;
    let exit: E2EServerDiagnostics['exit'] = null;
    const timeout = setTimeout(() => finish(new Error(`E2E server did not bind a port within ${timeoutMs}ms${output ? `\n${output}` : ''}`)), timeoutMs);

    const finish = (error?: Error, server?: E2EServer): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) {
        child.kill();
        reject(error);
      } else {
        resolve(server!);
      }
    };
    const inspectOutput = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
      const text = chunk.toString();
      output = `${output}${text}`.slice(-32_000);
      serverLog?.write(`[${stream}] ${text}`);
      const match = output.match(/Respawn server .* http:\/\/localhost:(\d+)/);
      if (!match) return;
      const port = Number(match[1]);
      finish(undefined, {
        process: child,
        baseUrl: `http://localhost:${port}`,
        port,
        diagnostics: () => ({ output, exit }),
      });
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      exit = { code, signal };
      serverLog?.write(`\n[process] exited with code ${code ?? 'null'}, signal ${signal ?? 'none'}\n`);
      serverLog?.end();
      finish(new Error(`E2E server exited before binding a port (code ${code}, signal ${signal ?? 'none'})${output ? `\n${output}` : ''}`));
    };

    child.stdout?.on('data', (chunk: Buffer) => inspectOutput('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => inspectOutput('stderr', chunk));
    child.once('error', (error) => {
      serverLog?.end();
      finish(new Error(`E2E server failed to spawn: ${error.message}${output ? `\n${output}` : ''}`));
    });
    child.once('exit', onExit);
  });
}
