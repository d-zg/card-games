/**
 * Tests for the database layer.
 *
 * Each test gets a fresh in-memory SQLite database.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type Db } from "../db.js";

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
});

describe("rooms", () => {
  it("creates a room and retrieves it", () => {
    const roomId = db.createRoom("air-land-sea");
    const room = db.getRoom(roomId);

    expect(room).not.toBeNull();
    expect(room!.id).toBe(roomId);
    expect(room!.gameType).toBe("air-land-sea");
    expect(room!.status).toBe("waiting");
    expect(room!.gameId).toBeNull();
  });

  it("returns null for unknown room", () => {
    expect(db.getRoom("nonexistent")).toBeNull();
  });

  it("updates room status and game ID", () => {
    const roomId = db.createRoom("air-land-sea");
    db.updateRoom(roomId, { status: "playing", gameId: "game-123" });

    const room = db.getRoom(roomId);
    expect(room!.status).toBe("playing");
    expect(room!.gameId).toBe("game-123");
  });

  it("updates only status, leaving gameId unchanged", () => {
    const roomId = db.createRoom("air-land-sea");
    db.updateRoom(roomId, { status: "playing" });

    const room = db.getRoom(roomId);
    expect(room!.status).toBe("playing");
    expect(room!.gameId).toBeNull();
  });

  it("updates only gameId, leaving status unchanged", () => {
    const roomId = db.createRoom("air-land-sea");
    db.updateRoom(roomId, { gameId: "game-456" });

    const room = db.getRoom(roomId);
    expect(room!.status).toBe("waiting");
    expect(room!.gameId).toBe("game-456");
  });

  it("silently no-ops when updating nonexistent room", () => {
    expect(() => db.updateRoom("nonexistent", { status: "playing" })).not.toThrow();
  });

  it("populates createdAt timestamp", () => {
    const roomId = db.createRoom("air-land-sea");
    const room = db.getRoom(roomId);
    expect(room!.createdAt).toBeTypeOf("string");
    expect(room!.createdAt.length).toBeGreaterThan(0);
  });
});

describe("players", () => {
  it("creates a player and retrieves by token", () => {
    const roomId = db.createRoom("air-land-sea");
    const token = db.createPlayer(roomId, "player-0", "Alice");

    const player = db.getPlayerByToken(token);
    expect(player).not.toBeNull();
    expect(player!.token).toBe(token);
    expect(player!.roomId).toBe(roomId);
    expect(player!.playerId).toBe("player-0");
    expect(player!.displayName).toBe("Alice");
  });

  it("returns null for unknown token", () => {
    expect(db.getPlayerByToken("bogus")).toBeNull();
  });

  it("lists all players in a room", () => {
    const roomId = db.createRoom("air-land-sea");
    db.createPlayer(roomId, "player-0", "Alice");
    db.createPlayer(roomId, "player-1", "Bob");

    const players = db.getPlayersByRoom(roomId);
    expect(players).toHaveLength(2);
    expect(players.map((p) => p.displayName).sort()).toEqual(["Alice", "Bob"]);
  });

  it("returns empty array for room with no players", () => {
    const roomId = db.createRoom("air-land-sea");
    expect(db.getPlayersByRoom(roomId)).toEqual([]);
  });

  it("enforces unique seat per room", () => {
    const roomId = db.createRoom("air-land-sea");
    db.createPlayer(roomId, "player-0", "Alice");

    expect(() => db.createPlayer(roomId, "player-0", "Eve")).toThrow();
  });

  it("allows same seat in different rooms", () => {
    const room1 = db.createRoom("air-land-sea");
    const room2 = db.createRoom("air-land-sea");
    db.createPlayer(room1, "player-0", "Alice");
    db.createPlayer(room2, "player-0", "Bob");

    expect(db.getPlayersByRoom(room1)).toHaveLength(1);
    expect(db.getPlayersByRoom(room2)).toHaveLength(1);
  });

  it("rejects player for nonexistent room (foreign key)", () => {
    expect(() => db.createPlayer("nonexistent", "player-0", "Alice")).toThrow();
  });

  it("removes a player from a seat", () => {
    const roomId = db.createRoom("air-land-sea");
    const token = db.createPlayer(roomId, "player-0", "Alice");

    db.removePlayer(token);
    expect(db.getPlayerByToken(token)).toBeNull();
    expect(db.getPlayersByRoom(roomId)).toHaveLength(0);
  });

  it("silently no-ops when removing nonexistent token", () => {
    expect(() => db.removePlayer("nonexistent")).not.toThrow();
  });

  it("replaces a player in a seat", () => {
    const roomId = db.createRoom("air-land-sea");
    const oldToken = db.createPlayer(roomId, "player-0", "Alice");

    db.removePlayer(oldToken);
    const newToken = db.createPlayer(roomId, "player-0", "Bob");

    expect(db.getPlayerByToken(oldToken)).toBeNull();
    const player = db.getPlayerByToken(newToken);
    expect(player!.displayName).toBe("Bob");
    expect(player!.playerId).toBe("player-0");
  });

  it("populates joinedAt timestamp", () => {
    const roomId = db.createRoom("air-land-sea");
    const token = db.createPlayer(roomId, "player-0", "Alice");
    const player = db.getPlayerByToken(token);
    expect(player!.joinedAt).toBeTypeOf("string");
    expect(player!.joinedAt.length).toBeGreaterThan(0);
  });
});

describe("games", () => {
  it("creates a game linked to a room", () => {
    const roomId = db.createRoom("air-land-sea");
    const gameId = db.createGame(roomId, "air-land-sea", 2, 42);

    const game = db.getGame(gameId);
    expect(game).not.toBeNull();
    expect(game!.id).toBe(gameId);
    expect(game!.roomId).toBe(roomId);
    expect(game!.gameType).toBe("air-land-sea");
    expect(game!.playerCount).toBe(2);
    expect(game!.baseSeed).toBe(42);
  });

  it("returns null for unknown game", () => {
    expect(db.getGame("nonexistent")).toBeNull();
  });

  it("rejects game for nonexistent room (foreign key)", () => {
    expect(() => db.createGame("nonexistent", "air-land-sea", 2, 42)).toThrow();
  });

  it("allows multiple games per room", () => {
    const roomId = db.createRoom("air-land-sea");
    const game1 = db.createGame(roomId, "air-land-sea", 2, 42);
    const game2 = db.createGame(roomId, "air-land-sea", 2, 99);

    expect(db.getGame(game1)).not.toBeNull();
    expect(db.getGame(game2)).not.toBeNull();
    expect(db.getGame(game1)!.baseSeed).toBe(42);
    expect(db.getGame(game2)!.baseSeed).toBe(99);
  });
});

describe("game actions", () => {
  it("inserts and retrieves actions in order", () => {
    const roomId = db.createRoom("air-land-sea");
    const gameId = db.createGame(roomId, "air-land-sea", 2, 42);

    db.insertAction(gameId, 1, "player-0", { type: "play", cardId: "air-6" });
    db.insertAction(gameId, 2, "player-1", { type: "play", cardId: "land-6" });
    db.insertAction(gameId, 3, "player-0", { type: "withdraw" });

    const actions = db.getActions(gameId);
    expect(actions).toHaveLength(3);
    expect(actions[0]).toMatchObject({
      gameId,
      version: 1,
      playerId: "player-0",
      action: { type: "play", cardId: "air-6" },
    });
    expect(actions[1].version).toBe(2);
    expect(actions[2].version).toBe(3);
    expect(actions[2].action).toEqual({ type: "withdraw" });
  });

  it("returns actions sorted by version regardless of insertion order", () => {
    const roomId = db.createRoom("air-land-sea");
    const gameId = db.createGame(roomId, "air-land-sea", 2, 42);

    db.insertAction(gameId, 3, "player-0", { type: "third" });
    db.insertAction(gameId, 1, "player-0", { type: "first" });
    db.insertAction(gameId, 2, "player-1", { type: "second" });

    const actions = db.getActions(gameId);
    expect(actions.map((a) => a.version)).toEqual([1, 2, 3]);
    expect(actions[0].action).toEqual({ type: "first" });
  });

  it("returns empty array for game with no actions", () => {
    const roomId = db.createRoom("air-land-sea");
    const gameId = db.createGame(roomId, "air-land-sea", 2, 42);

    expect(db.getActions(gameId)).toEqual([]);
  });

  it("enforces unique version per game", () => {
    const roomId = db.createRoom("air-land-sea");
    const gameId = db.createGame(roomId, "air-land-sea", 2, 42);

    db.insertAction(gameId, 1, "player-0", { type: "play" });
    expect(() => db.insertAction(gameId, 1, "player-1", { type: "play" })).toThrow();
  });

  it("round-trips complex nested JSON actions", () => {
    const roomId = db.createRoom("air-land-sea");
    const gameId = db.createGame(roomId, "air-land-sea", 2, 42);

    const complexAction = {
      type: "play",
      cardId: "air-6",
      nested: { deeply: { value: [1, 2, 3] } },
      flag: true,
      count: 42,
      nothing: null,
    };
    db.insertAction(gameId, 1, "player-0", complexAction);

    const actions = db.getActions(gameId);
    expect(actions[0].action).toEqual(complexAction);
  });
});
