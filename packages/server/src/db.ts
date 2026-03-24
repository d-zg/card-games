import Database from "better-sqlite3";
import { nanoid } from "nanoid";

export interface Room {
  id: string;
  gameType: string;
  status: string;
  gameId: string | null;
  createdAt: string;
  wins: Record<string, number>;
}

export interface Player {
  token: string;
  roomId: string;
  playerId: string;
  displayName: string;
  joinedAt: string;
}

export interface Game {
  id: string;
  roomId: string;
  gameType: string;
  playerCount: number;
  baseSeed: number;
  createdAt: string;
}

export interface GameAction {
  gameId: string;
  version: number;
  playerId: string;
  action: unknown;
  createdAt: string;
}

export interface Db {
  createRoom(gameType: string): string;
  getRoom(roomId: string): Room | null;
  updateRoom(roomId: string, fields: { status?: string; gameId?: string }): void;
  recordWin(roomId: string, playerId: string): void;

  createPlayer(roomId: string, playerId: string, displayName: string): string;
  getPlayerByToken(token: string): Player | null;
  getPlayersByRoom(roomId: string): Player[];
  removePlayer(token: string): void;

  createGame(roomId: string, gameType: string, playerCount: number, baseSeed: number): string;
  getGame(gameId: string): Game | null;

  insertAction(gameId: string, version: number, playerId: string, action: unknown): void;
  getActions(gameId: string): GameAction[];
}

// Bump this when the schema changes. The DB will refuse to start
// if the version doesn't match, with a message to delete the DB file.
const SCHEMA_VERSION = 2;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS _schema_version (
    version INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id          TEXT PRIMARY KEY,
    game_type   TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'waiting',
    game_id     TEXT,
    wins        TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS players (
    token         TEXT PRIMARY KEY,
    room_id       TEXT NOT NULL REFERENCES rooms(id),
    player_id     TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    joined_at     TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(room_id, player_id)
  );

  CREATE TABLE IF NOT EXISTS games (
    id            TEXT PRIMARY KEY,
    room_id       TEXT NOT NULL REFERENCES rooms(id),
    game_type     TEXT NOT NULL,
    player_count  INTEGER NOT NULL,
    base_seed     INTEGER NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS game_actions (
    game_id     TEXT NOT NULL,
    version     INTEGER NOT NULL,
    player_id   TEXT NOT NULL,
    action      TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (game_id, version)
  );
`;

export function createDb(path: string): Db {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);

  // Check schema version
  const row = db.prepare("SELECT version FROM _schema_version").get() as { version: number } | undefined;
  if (!row) {
    // Fresh DB — stamp the version
    db.prepare("INSERT INTO _schema_version (version) VALUES (?)").run(SCHEMA_VERSION);
  } else if (row.version !== SCHEMA_VERSION) {
    const dbPath = path === ":memory:" ? "in-memory DB" : path;
    throw new Error(
      `Database schema version mismatch: DB is v${row.version}, server expects v${SCHEMA_VERSION}. ` +
      `Delete ${dbPath} and restart.`,
    );
  }

  // Prepared statements
  const insertRoom = db.prepare(
    "INSERT INTO rooms (id, game_type) VALUES (?, ?)",
  );
  const selectRoom = db.prepare("SELECT * FROM rooms WHERE id = ?");
  const updateRoomStmt = db.prepare(
    "UPDATE rooms SET status = COALESCE(?, status), game_id = COALESCE(?, game_id) WHERE id = ?",
  );
  const selectRoomWins = db.prepare("SELECT wins FROM rooms WHERE id = ?");
  const updateRoomWins = db.prepare("UPDATE rooms SET wins = ? WHERE id = ?");

  const insertPlayer = db.prepare(
    "INSERT INTO players (token, room_id, player_id, display_name) VALUES (?, ?, ?, ?)",
  );
  const selectPlayerByToken = db.prepare(
    "SELECT * FROM players WHERE token = ?",
  );
  const selectPlayersByRoom = db.prepare(
    "SELECT * FROM players WHERE room_id = ?",
  );
  const deletePlayer = db.prepare("DELETE FROM players WHERE token = ?");

  const insertGame = db.prepare(
    "INSERT INTO games (id, room_id, game_type, player_count, base_seed) VALUES (?, ?, ?, ?, ?)",
  );
  const selectGame = db.prepare("SELECT * FROM games WHERE id = ?");

  const insertActionStmt = db.prepare(
    "INSERT INTO game_actions (game_id, version, player_id, action) VALUES (?, ?, ?, ?)",
  );
  const selectActions = db.prepare(
    "SELECT * FROM game_actions WHERE game_id = ? ORDER BY version",
  );

  return {
    createRoom(gameType: string): string {
      const id = nanoid();
      insertRoom.run(id, gameType);
      return id;
    },

    getRoom(roomId: string): Room | null {
      const row = selectRoom.get(roomId) as Record<string, unknown> | undefined;
      if (!row) return null;
      return {
        id: row.id as string,
        gameType: row.game_type as string,
        status: row.status as string,
        gameId: (row.game_id as string) ?? null,
        createdAt: row.created_at as string,
        wins: JSON.parse((row.wins as string) ?? "{}"),
      };
    },

    updateRoom(roomId: string, fields: { status?: string; gameId?: string }): void {
      updateRoomStmt.run(fields.status ?? null, fields.gameId ?? null, roomId);
    },

    recordWin(roomId: string, playerId: string): void {
      const row = selectRoomWins.get(roomId) as { wins: string } | undefined;
      const wins = JSON.parse(row?.wins ?? "{}");
      wins[playerId] = (wins[playerId] ?? 0) + 1;
      updateRoomWins.run(JSON.stringify(wins), roomId);
    },

    createPlayer(roomId: string, playerId: string, displayName: string): string {
      const token = nanoid();
      insertPlayer.run(token, roomId, playerId, displayName);
      return token;
    },

    getPlayerByToken(token: string): Player | null {
      const row = selectPlayerByToken.get(token) as Record<string, unknown> | undefined;
      if (!row) return null;
      return {
        token: row.token as string,
        roomId: row.room_id as string,
        playerId: row.player_id as string,
        displayName: row.display_name as string,
        joinedAt: row.joined_at as string,
      };
    },

    getPlayersByRoom(roomId: string): Player[] {
      const rows = selectPlayersByRoom.all(roomId) as Record<string, unknown>[];
      return rows.map((row) => ({
        token: row.token as string,
        roomId: row.room_id as string,
        playerId: row.player_id as string,
        displayName: row.display_name as string,
        joinedAt: row.joined_at as string,
      }));
    },

    removePlayer(token: string): void {
      deletePlayer.run(token);
    },

    createGame(roomId: string, gameType: string, playerCount: number, baseSeed: number): string {
      const id = nanoid();
      insertGame.run(id, roomId, gameType, playerCount, baseSeed);
      return id;
    },

    getGame(gameId: string): Game | null {
      const row = selectGame.get(gameId) as Record<string, unknown> | undefined;
      if (!row) return null;
      return {
        id: row.id as string,
        roomId: row.room_id as string,
        gameType: row.game_type as string,
        playerCount: row.player_count as number,
        baseSeed: row.base_seed as number,
        createdAt: row.created_at as string,
      };
    },

    insertAction(gameId: string, version: number, playerId: string, action: unknown): void {
      insertActionStmt.run(gameId, version, playerId, JSON.stringify(action));
    },

    getActions(gameId: string): GameAction[] {
      const rows = selectActions.all(gameId) as Record<string, unknown>[];
      return rows.map((row) => ({
        gameId: row.game_id as string,
        version: row.version as number,
        playerId: row.player_id as string,
        action: JSON.parse(row.action as string),
        createdAt: row.created_at as string,
      }));
    },
  };
}
