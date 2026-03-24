/**
 * WebSocket integration tests.
 *
 * Spins up a real HTTP server with WS, connects actual clients,
 * and verifies that actions broadcast the right views to the right people.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "http";
import WebSocket from "ws";
import { createDb, type Db } from "../db.js";
import { createGameManager, type GameManager } from "../game-manager.js";
import { createApp } from "../app.js";
import { attachWebSocket } from "../ws.js";
import { alsGame } from "@card-games/shared/src/games/air-land-sea/index.js";
import request from "supertest";
import type { Express } from "express";

let db: Db;
let manager: GameManager;
let app: Express;
let server: Server;
let port: number;
let gameId: string;
let p0Token: string;
let p1Token: string;

beforeEach(async () => {
  db = createDb(":memory:");
  manager = createGameManager(db, { "air-land-sea": alsGame });
  app = createApp(db, manager);
  server = createServer(app);
  attachWebSocket(server, db, manager);

  // Start on random port
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });
  port = (server.address() as { port: number }).port;

  // Set up a game
  const roomId = db.createRoom("air-land-sea");
  p0Token = db.createPlayer(roomId, "player-0", "Alice");
  p1Token = db.createPlayer(roomId, "player-1", "Bob");
  gameId = manager.createGame(roomId, "air-land-sea", 2);
  db.updateRoom(roomId, { status: "playing", gameId });
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

function connectWs(token?: string): WebSocket {
  const url = token
    ? `ws://localhost:${port}/ws?token=${token}`
    : `ws://localhost:${port}/ws`;
  return new WebSocket(url);
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once("message", (data) => {
      resolve(JSON.parse(data.toString()));
    });
  });
}

describe("WebSocket", () => {
  it("sends initial state on subscribe, then broadcasts on action", async () => {
    const ws = connectWs(p1Token);
    await waitForOpen(ws);

    // Subscribe — should receive initial state immediately
    const initialPromise = waitForMessage(ws);
    ws.send(JSON.stringify({ type: "subscribe", gameId }));

    const initial = (await initialPromise) as Record<string, unknown>;
    expect(initial.type).toBe("state");
    expect(initial.gameId).toBe(gameId);
    expect(initial.version).toBeTypeOf("number");
    const initialView = initial.view as Record<string, unknown>;
    expect(initialView.myPlayerId).toBe("player-1");
    expect(initialView.currentPlayer).toBe("player-0");

    // P0 acts via REST
    const stateRes = await request(app)
      .get(`/api/games/${gameId}/state`)
      .set("Authorization", `Bearer ${p0Token}`);
    const cardId = stateRes.body.view.myHand[0];

    const broadcastPromise = waitForMessage(ws);

    await request(app)
      .post(`/api/games/${gameId}/action`)
      .set("Authorization", `Bearer ${p0Token}`)
      .send({ type: "play", cardId, theater: "land", faceUp: false });

    // P1 should receive broadcast with updated state
    const broadcast = (await broadcastPromise) as Record<string, unknown>;
    expect(broadcast.type).toBe("state");
    expect(broadcast.version).toBe((initial.version as number) + 1);
    const broadcastView = broadcast.view as Record<string, unknown>;
    expect(broadcastView.myPlayerId).toBe("player-1");
    expect(broadcastView.currentPlayer).toBe("player-1");

    ws.close();
  });

  it("spectator receives spectator view on subscribe and broadcast", async () => {
    const ws = connectWs(); // no token
    await waitForOpen(ws);

    // Subscribe — get initial spectator view
    const initialPromise = waitForMessage(ws);
    ws.send(JSON.stringify({ type: "subscribe", gameId }));

    const initial = (await initialPromise) as Record<string, unknown>;
    const initialView = initial.view as Record<string, unknown>;
    expect(initialView.myPlayerId).toBeNull();
    expect(initialView.myHand).toEqual([]);

    // P0 acts
    const stateRes = await request(app)
      .get(`/api/games/${gameId}/state`)
      .set("Authorization", `Bearer ${p0Token}`);
    const cardId = stateRes.body.view.myHand[0];

    const broadcastPromise = waitForMessage(ws);

    await request(app)
      .post(`/api/games/${gameId}/action`)
      .set("Authorization", `Bearer ${p0Token}`)
      .send({ type: "play", cardId, theater: "land", faceUp: false });

    const broadcast = (await broadcastPromise) as Record<string, unknown>;
    const broadcastView = broadcast.view as Record<string, unknown>;
    expect(broadcastView.myPlayerId).toBeNull();
    expect(broadcastView.myHand).toEqual([]);

    ws.close();
  });

  it("receives error when subscribing to nonexistent game", async () => {
    const ws = connectWs(p0Token);
    await waitForOpen(ws);

    const msgPromise = waitForMessage(ws);
    ws.send(JSON.stringify({ type: "subscribe", gameId: "nonexistent" }));

    const msg = (await msgPromise) as Record<string, unknown>;
    expect(msg.type).toBe("error");

    ws.close();
  });
});
