// Sends the currently seen process names to the server's agent-report
// endpoint. Uses the global fetch (Node 18+) so there's no extra dependency
// to bundle into the packaged .exe.

async function reportToServer({ serverUrl, apiKey }, processNames, activitySnapshot) {
  const requestBody = { processNames };
  if (activitySnapshot) {
    requestBody.foregroundProcessName = activitySnapshot.foregroundProcessName;
    requestBody.idleSeconds = activitySnapshot.idleSeconds;
  }

  const res = await fetch(`${serverUrl}/api/agent/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(requestBody),
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

module.exports = { reportToServer };
