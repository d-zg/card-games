/**
 * Tests for room routes.
 *
 * Each test gets a fresh in-memory DB, game manager, and Express app.
 */
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createDb, type Db } from "../db.js";
import { createGameManager, type GameManager } from "../game-manager.js";
import { createApp } from "../app.js";
import { alsGame } from "@card-games/shared/src/games/air-land-sea/index.js";
import type { Express } from "express";

let db: Db;
let manager: GameManager;
let app: Express;

beforeEach(() => {
  db = createDb(":memory:");
  manager = createGameManager(db, { "air-land-sea": alsGame });
  app = createApp(db, manager);
});

describe("POST /api/rooms", () => {
  it("creates a room and returns its ID", async () => {
    const res = await request(app)
      .post("/api/rooms")
      .send({ gameType: "air-land-sea" });

    expect(res.status).toBe(201);
    expect(res.body.roomId).toBeTypeOf("string");

    // Room should exist in DB
    const room = db.getRoom(res.body.roomId);
    expect(room).not.toBeNull();
    expect(room!.gameType).toBe("air-land-sea");
    expect(room!.status).toBe("waiting");
  });

  it("rejects missing gameType", async () => {
    const res = await request(app).post("/api/rooms").send({});
    expect(res.status).toBe(400);
  });

  it("rejects unknown gameType", async () => {
    const res = await request(app)
      .post("/api/rooms")
      .send({ gameType: "nonexistent" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/rooms/:roomId", () => {
  it("returns room info with player list", async () => {
    const roomId = db.createRoom("air-land-sea");
    db.createPlayer(roomId, "player-0", "Alice");

    const res = await request(app).get(`/api/rooms/${roomId}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(roomId);
    expect(res.body.gameType).toBe("air-land-sea");
    expect(res.body.status).toBe("waiting");
    expect(res.body.players).toHaveLength(1);
    expect(res.body.players[0]).toMatchObject({
      playerId: "player-0",
      displayName: "Alice",
    });
  });

  it("does not expose player tokens", async () => {
    const roomId = db.createRoom("air-land-sea");
    db.createPlayer(roomId, "player-0", "Alice");

    const res = await request(app).get(`/api/rooms/${roomId}`);

    expect(res.body.players[0]).not.toHaveProperty("token");
  });

  it("returns 404 for unknown room", async () => {
    const res = await request(app).get("/api/rooms/nonexistent");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/rooms/:roomId/join", () => {
  it("joins a seat and returns a token", async () => {
    const roomId = db.createRoom("air-land-sea");

    const res = await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .send({ playerId: "player-0", displayName: "Alice" });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTypeOf("string");

    // Player should be in DB
    const player = db.getPlayerByToken(res.body.token);
    expect(player).not.toBeNull();
    expect(player!.playerId).toBe("player-0");
    expect(player!.displayName).toBe("Alice");
  });

  it("rejects joining a seat that is already taken", async () => {
    const roomId = db.createRoom("air-land-sea");
    db.createPlayer(roomId, "player-0", "Alice");

    const res = await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .send({ playerId: "player-0", displayName: "Eve" });

    expect(res.status).toBe(409);
  });

  it("returns 404 for unknown room", async () => {
    const res = await request(app)
      .post("/api/rooms/nonexistent/join")
      .send({ playerId: "player-0", displayName: "Alice" });

    expect(res.status).toBe(404);
  });

  it("rejects missing fields", async () => {
    const roomId = db.createRoom("air-land-sea");

    const noName = await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .send({ playerId: "player-0" });
    expect(noName.status).toBe(400);

    const noId = await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .send({ displayName: "Alice" });
    expect(noId.status).toBe(400);
  });

  it("rejects joining when room is full", async () => {
    const roomId = db.createRoom("air-land-sea");
    // ALS maxPlayers is 2
    await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .send({ playerId: "player-0", displayName: "Alice" });
    await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .send({ playerId: "player-1", displayName: "Bob" });

    // Third player should be rejected
    const res = await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .send({ playerId: "player-2", displayName: "Charlie" });

    expect(res.status).toBe(400);
    expect(db.getPlayersByRoom(roomId)).toHaveLength(2);
  });

  it("rejects joining a room that is already playing", async () => {
    const roomId = db.createRoom("air-land-sea");
    db.createPlayer(roomId, "player-0", "Alice");
    db.createPlayer(roomId, "player-1", "Bob");
    db.updateRoom(roomId, { status: "playing" });

    const res = await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .send({ playerId: "player-0", displayName: "Eve" });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/rooms/:roomId/leave", () => {
  it("removes a player from their seat", async () => {
    const roomId = db.createRoom("air-land-sea");
    const token = db.createPlayer(roomId, "player-0", "Alice");

    const res = await request(app)
      .post(`/api/rooms/${roomId}/leave`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(db.getPlayerByToken(token)).toBeNull();
    expect(db.getPlayersByRoom(roomId)).toHaveLength(0);
  });

  it("returns 401 without a token", async () => {
    const roomId = db.createRoom("air-land-sea");

    const res = await request(app).post(`/api/rooms/${roomId}/leave`);
    expect(res.status).toBe(401);
  });

  it("returns 401 with invalid token", async () => {
    const roomId = db.createRoom("air-land-sea");

    const res = await request(app)
      .post(`/api/rooms/${roomId}/leave`)
      .set("Authorization", "Bearer bogus");
    expect(res.status).toBe(401);
  });

  it("rejects leaving a room that is already playing", async () => {
    const roomId = db.createRoom("air-land-sea");
    const token = db.createPlayer(roomId, "player-0", "Alice");
    db.createPlayer(roomId, "player-1", "Bob");
    db.updateRoom(roomId, { status: "playing" });

    const res = await request(app)
      .post(`/api/rooms/${roomId}/leave`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    // Player should still exist
    expect(db.getPlayerByToken(token)).not.toBeNull();
  });
});

describe("POST /api/rooms/:roomId/start", () => {
  it("starts a game when enough players are seated", async () => {
    const roomId = db.createRoom("air-land-sea");
    const token = db.createPlayer(roomId, "player-0", "Alice");
    db.createPlayer(roomId, "player-1", "Bob");

    const res = await request(app)
      .post(`/api/rooms/${roomId}/start`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.gameId).toBeTypeOf("string");

    // Room should be updated
    const room = db.getRoom(roomId);
    expect(room!.status).toBe("playing");
    expect(room!.gameId).toBe(res.body.gameId);

    // Game should exist
    const game = db.getGame(res.body.gameId);
    expect(game).not.toBeNull();
  });

  it("rejects if not enough players", async () => {
    const roomId = db.createRoom("air-land-sea");
    const token = db.createPlayer(roomId, "player-0", "Alice");

    const res = await request(app)
      .post(`/api/rooms/${roomId}/start`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it("rejects if game already started", async () => {
    const roomId = db.createRoom("air-land-sea");
    const token = db.createPlayer(roomId, "player-0", "Alice");
    db.createPlayer(roomId, "player-1", "Bob");
    db.updateRoom(roomId, { status: "playing" });

    const res = await request(app)
      .post(`/api/rooms/${roomId}/start`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it("rejects without auth token", async () => {
    const roomId = db.createRoom("air-land-sea");
    db.createPlayer(roomId, "player-0", "Alice");
    db.createPlayer(roomId, "player-1", "Bob");

    const res = await request(app).post(`/api/rooms/${roomId}/start`);
    expect(res.status).toBe(401);
  });

  it("rejects if token is not for this room", async () => {
    const room1 = db.createRoom("air-land-sea");
    const room2 = db.createRoom("air-land-sea");
    const token = db.createPlayer(room2, "player-0", "Alice");
    db.createPlayer(room1, "player-0", "Alice");
    db.createPlayer(room1, "player-1", "Bob");

    const res = await request(app)
      .post(`/api/rooms/${room1}/start`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});
