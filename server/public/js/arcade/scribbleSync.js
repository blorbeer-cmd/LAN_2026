// Reconnect payloads may still contain the previous drawing while the server
// is already in reveal/choosing. Only a live drawing phase may repopulate the
// client's replay mirror; every turn boundary starts with a blank canvas.
export function strokesForScribbleSync(sync) {
  return sync?.phase === 'drawing' && Array.isArray(sync.strokes) ? sync.strokes : [];
}
