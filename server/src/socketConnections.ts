import type { Server, Socket } from 'socket.io';

export type SocketConnectionOwner =
  | 'scope'
  | 'live-status'
  | 'arcade-realtime'
  | 'arcade-quiz'
  | 'arcade-tetris'
  | 'arcade-scribble'
  | 'arcade-blobby'
  | 'arcade-pong'
  | 'arcade-snake'
  | 'arcade-battleship'
  | 'arcade-challenge-rush';

type SocketConnectionHandler = (socket: Socket) => void;

interface ConnectionRegistry {
  handlers: Map<SocketConnectionOwner, SocketConnectionHandler>;
  dispatch: SocketConnectionHandler;
  cleanup: () => void;
}

const registries = new WeakMap<Server, ConnectionRegistry>();

function createRegistry(server: Server): ConnectionRegistry {
  const handlers = new Map<SocketConnectionOwner, SocketConnectionHandler>();
  const dispatch = (socket: Socket) => {
    for (const handler of handlers.values()) handler(socket);
  };
  const cleanup = () => {
    server.off('connection', dispatch);
    server.httpServer?.off('close', cleanup);
    handlers.clear();
    registries.delete(server);
  };
  const registry = { handlers, dispatch, cleanup };
  server.on('connection', dispatch);
  server.httpServer?.once('close', cleanup);
  registries.set(server, registry);
  return registry;
}

// All Socket.IO features share one Namespace "connection" listener. Feature
// handlers stay separate, but no longer consume EventEmitter listener slots.
// The HTTP close hook also removes the dispatcher after test/server shutdown.
export function registerSocketConnection(
  server: Server,
  owner: SocketConnectionOwner,
  handler: SocketConnectionHandler,
): () => void {
  const registry = registries.get(server) ?? createRegistry(server);
  if (registry.handlers.has(owner)) {
    throw new Error(`Socket connection handler "${owner}" wurde bereits registriert.`);
  }
  registry.handlers.set(owner, handler);

  return () => {
    const current = registries.get(server);
    if (current !== registry || current.handlers.get(owner) !== handler) return;
    current.handlers.delete(owner);
    if (current.handlers.size === 0) current.cleanup();
  };
}
