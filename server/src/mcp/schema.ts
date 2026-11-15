import type Database from 'better-sqlite3';

// Called by the numbered migration, never lazily while handling requests.
export function installMcpSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS mcp_clients (
      id TEXT PRIMARY KEY, redirect_uri TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mcp_connections (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES mcp_clients(id),
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      scopes TEXT NOT NULL,
      access_hash TEXT NOT NULL UNIQUE,
      refresh_hash TEXT NOT NULL UNIQUE,
      access_expires_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      revoked_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS mcp_connections_player ON mcp_connections(player_id);
    CREATE TABLE IF NOT EXISTS draw_cleanup_plans (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      connection_id TEXT REFERENCES mcp_connections(id) ON DELETE CASCADE,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      approved_at INTEGER,
      completed_at INTEGER,
      outcome TEXT
    );
    CREATE INDEX IF NOT EXISTS draw_cleanup_plans_owner ON draw_cleanup_plans(player_id, expires_at);
  `);
}
