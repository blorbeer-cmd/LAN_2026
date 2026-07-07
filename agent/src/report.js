// Sends the currently seen process names to the server's agent-report
// endpoint. Uses the global fetch (Node 18+) so there's no extra dependency
// to bundle into the packaged .exe.

async function reportToServer({ serverUrl, apiKey }, processNames) {
  const res = await fetch(`${serverUrl}/api/agent/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ processNames }),
  });

  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!res.ok) {
    const message = (body && body.error) || `Serverfehler ${res.status}`;
    throw new Error(message);
  }
  return body;
}

module.exports = { reportToServer };
