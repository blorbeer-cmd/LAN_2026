const path = require('node:path');

const serverDirectory = path.resolve(__dirname, '..');

function e2eArtifactDirectory(env = process.env) {
  return path.resolve(env.E2E_ARTIFACT_DIR ?? path.join(serverDirectory, 'test-results', 'e2e'));
}

module.exports = { e2eArtifactDirectory };
