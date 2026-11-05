// Test files and migration fixtures keep their separate processes/databases.
// Reuse only Node's compiled JavaScript, including in fresh child processes.
import { enableCompileCache } from 'node:module';
import { fileURLToPath } from 'node:url';

const { directory } = enableCompileCache(fileURLToPath(new URL('../node_modules/.cache/test-bytecode/', import.meta.url)));
if (directory) process.env.NODE_COMPILE_CACHE = directory;
