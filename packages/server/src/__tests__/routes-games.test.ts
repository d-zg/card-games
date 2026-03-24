/**
 * Tests for game routes.
 *
 * Minimal — verifies wiring, auth, and error translation.
 * Game logic is tested in the shared package and game manager.
 */
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createDb, type Db } from "../db.js";
import { createGameManager, type GameManager } from "../game-manager.js";
import { createApp } from "../app.js";
import { alsGame } from "@card-games/shared/src/games/air-land-sea/index.js";
import type { Express } from "express";
import type { ALSView } from "@card-games/shared/src/games/air-land-sea/types.js";

let db: Db;
let manager: GameManager;
let app: Express;
let gameId: string;
let p0Token: string;
let p1Token: string;

beforeEach(() => {
  db = createDb(":memory:");
  manager = createGameManager(db, { "air-land-sea": alsGame });
  app = createApp(db, manager);

  // Set up a room with 2 players and start a game
  const roomId = db.createRoom("air-land-sea");
  p0Token = db.createPlayer(roomId, "player-0", "Alice");
  p1Token = db.createPlayer(roomId, "player-1", "Bob");
  gameId = manager.createGame(roomId, "air-land-sea", 2);
  db.updateRoom(roomId, { status: "playing", gameId });
});

describe("GET /api/games/:gameId/state", () => {
  it("returns player view with version and valid token", async () => {
    const res = await request(app)
      .get(`/api/games/${gameId}/state`)
      .set("Authorization", `Bearer ${p0Token}`);

    expect(res.status).toBe(200);
    expect(res.body.version).toBe(0);
    expect(res.body.view.myPlayerId).toBe("player-0");
    expect(res.body.view.myHand).toHaveLength(6);
    expect(res.body.view.phase).toBe("playing");
  });

  it("returns spectator view with version without token", async () => {
    const res = await request(app).get(`/api/games/${gameId}/state`);

    expect(res.status).toBe(200);
    expect(res.body.version).toBe(0);
    expect(res.body.view.myPlayerId).toBeNull();
    expect(res.body.view.myHand).toEqual([]);
  });

  it("returns 404 for unknown game", async () => {
    const res = await request(app)
      .get("/api/games/nonexistent/state")
      .set("Authorization", `Bearer ${p0Token}`);

    expect(res.status).toBe(404);
  });
});

describe("POST /api/games/:gameId/action", () => {
  it("applies action and returns updated view with version", async () => {
    // Get a card to play
    const stateRes = await request(app)
      .get(`/api/games/${gameId}/state`)
      .set("Authorization", `Bearer ${p0Token}`);
    const cardId = stateRes.body.view.myHand[0];

    const res = await request(app)
      .post(`/api/games/${gameId}/action`)
      .set("Authorization", `Bearer ${p0Token}`)
      .send({ type: "play", cardId, theater: "land", faceUp: false });

    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
    expect(res.body.view.myHand).toHaveLength(5);
    expect(res.body.view.currentPlayer).toBe("player-1");
  });

  it("returns 401 without token", async () => {
    const res = await request(app)
      .post(`/api/games/${gameId}/action`)
      .send({ type: "withdraw" });

    expect(res.status).toBe(401);
  });

  it("returns 400 when engine rejects the action", async () => {
    // player-1 tries to act on player-0's turn
    const res = await request(app)
      .post(`/api/games/${gameId}/action`)
      .set("Authorization", `Bearer ${p1Token}`)
      .send({ type: "withdraw" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTypeOf("string");
  });

  it("returns 404 for unknown game", async () => {
    const res = await request(app)
      .post("/api/games/nonexistent/action")
      .set("Authorization", `Bearer ${p0Token}`)
      .send({ type: "withdraw" });

    expect(res.status).toBe(404);
  });
});
