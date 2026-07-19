// Socket.IO client setup. Authenticates with the same shared access token as
// the REST API (server-side enforced in index.ts's io.use()).

import { getToken } from './api.js';

export function connectSocket({ kiosk = false } = {}) {
  return io({ auth: { token: getToken(), kiosk } });
}
