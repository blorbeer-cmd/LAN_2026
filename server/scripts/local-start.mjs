import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

export function prepareLocalEnvironment(source = process.env, randomBytes = crypto.randomBytes) {
  const env = { ...source };
  if (env.NODE_ENV === 'production') return { env, generatedRecoveryCode: null };
  const hasRecoveryCode = Boolean(env.ADMIN_RECOVERY_CODE?.trim());
  const hasBootstrapAdmin = Object.keys(env).some((key) => {
    const match = /^BOOTSTRAP_ADMIN_(\d+)_NAME$/.exec(key);
    if (!match || !env[key]?.trim()) return false;
    return Boolean(env[`BOOTSTRAP_ADMIN_${match[1]}_PASSWORD`]?.trim());
  });

  if (hasRecoveryCode || hasBootstrapAdmin) return { env, generatedRecoveryCode: null };

  const generatedRecoveryCode = randomBytes(32).toString('hex');
  env.ADMIN_RECOVERY_CODE = generatedRecoveryCode;
  env.LOCAL_GENERATED_RECOVERY_CODE = '1';
  return { env, generatedRecoveryCode };
}

function run() {
  const mode = process.argv[2];
  if (mode !== 'start' && mode !== 'dev') {
    console.error('usage: node scripts/local-start.mjs <start|dev>');
    process.exit(2);
  }

  const { env } = prepareLocalEnvironment();
  const args =
    mode === 'start'
      ? ['dist/index.js']
      : [require.resolve('ts-node-dev/lib/bin.js'), '--respawn', '--transpile-only', 'src/index.ts'];
  const child = spawn(process.execPath, args, { env, stdio: 'inherit' });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
  }
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
