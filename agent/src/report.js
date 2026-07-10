// Sends the currently seen process names to the server's agent-report
// endpoint, and a small helper to push the local pause toggle up to the
// server. Uses the global fetch (Node 18+) so there's no extra dependency to
// bundle into the packaged .exe.

const AGENT_VERSION = require('../package.json').version;

async function postJson(serverUrl, apiKey, path, body) {
  const res = await fetch(`${serverUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let responseBody = null;
  if (text) {
    try {
      responseBody = JSON.parse(text);
    } catch {
      responseBody = null;
    }
  }

  if (!res.ok) {
    const message = (responseBody && responseBody.error) || `Serverfehler ${res.status}`;
    throw new Error(message);
  }
  return responseBody;
}

async function reportToServer({ serverUrl, apiKey }, processNames, activitySnapshot) {
  const requestBody = { processNames, agentVersion: AGENT_VERSION };
  if (activitySnapshot) {
    requestBody.foregroundProcessName = activitySnapshot.foregroundProcessName;
    requestBody.idleSeconds = activitySnapshot.idleSeconds;
  }
  return postJson(serverUrl, apiKey, '/api/agent/report', requestBody);
}

// Mirrors a local pause/resume up to the server, so the web profile's
// "Tracking pausieren" toggle and this agent's own control panel stay in
// sync instead of being two independent, potentially-disagreeing flags.
// Best-effort by design (callers swallow failures) — the local toggle must
// still work instantly even if the PC is briefly offline.
async function syncTrackingPaused({ serverUrl, apiKey }, paused) {
  return postJson(serverUrl, apiKey, '/api/agent/tracking-paused', { paused });
}

module.exports = { reportToServer, syncTrackingPaused };
