import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

export interface E2EServer {
  process: ChildProcess;
  baseUrl: string;
  port: number;
}

export function startE2EServer(env: NodeJS.ProcessEnv, timeoutMs = 10_000): Promise<E2EServer> {
  const child = spawn('node', [path.join(__dirname, '..', '..', '..', 'dist', 'index.js')], {
    env: { ...env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return new Promise((resolve, reject) => {
    let output = '';
    let settled = false;
    const timeout = setTimeout(() => finish(new Error(`E2E server did not bind a port within ${timeoutMs}ms${output ? `\n${output}` : ''}`)), timeoutMs);

    const finish = (error?: Error, server?: E2EServer): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeListener('exit', onExit);
      if (error) {
        child.kill();
        reject(error);
      } else {
        resolve(server!);
      }
    };
    const inspectOutput = (chunk: Buffer): void => {
      output = `${output}${chunk.toString()}`.slice(-8_000);
      const match = output.match(/Respawn server .* http:\/\/localhost:(\d+)/);
      if (!match) return;
      const port = Number(match[1]);
      finish(undefined, { process: child, baseUrl: `http://localhost:${port}`, port });
    };
    const onExit = (code: number | null): void => finish(new Error(`E2E server exited before binding a port (code ${code})${output ? `\n${output}` : ''}`));

    child.stdout?.on('data', inspectOutput);
    child.stderr?.on('data', inspectOutput);
    child.once('error', (error) => finish(error));
    child.once('exit', onExit);
  });
}
