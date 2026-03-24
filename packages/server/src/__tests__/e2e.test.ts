/**
 * End-to-end test through the full HTTP API.
 *
 * No direct DB access — everything goes through the routes.
 * Verifies the wiring between room routes, game routes, game manager, and DB.
 */
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createDb } from "../db.js";
import { createGameManager } from "../game-manager.js";
import { createApp } from "../app.js";
import { alsGame } from "@card-games/shared/src/games/air-land-sea/index.js";
import type { Express } from "express";

let app: Express;

beforeEach(() => {
  const db = createDb(":memory:");
  const manager = createGameManager(db, { "air-land-sea": alsGame });
  app = createApp(db, manager);
});

describe("end-to-end game lifecycle", () => {
  it("create room → join → start → play → verify state", async () => {
    // 1. Create a room
    const createRes = await request(app)
      .post("/api/rooms")
      .send({ gameType: "air-land-sea" });
    expect(createRes.status).toBe(201);
    const { roomId } = createRes.body;

    // 2. Two players join
    const join0 = await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .send({ playerId: "player-0", displayName: "Alice" });
    expect(join0.status).toBe(200);
    const p0Token = join0.body.token;

    const join1 = await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .send({ playerId: "player-1", displayName: "Bob" });
    expect(join1.status).toBe(200);
    const p1Token = join1.body.token;

    // 3. Verify room shows both players (without leaking tokens)
    const roomRes = await request(app).get(`/api/rooms/${roomId}`);
    expect(roomRes.body.status).toBe("waiting");
    expect(roomRes.body.players).toHaveLength(2);
    expect(roomRes.body.players[0]).not.toHaveProperty("token");

    // 4. Start the game
    const startRes = await request(app)
      .post(`/api/rooms/${roomId}/start`)
      .set("Authorization", `Bearer ${p0Token}`);
    expect(startRes.status).toBe(200);
    const { gameId } = startRes.body;

    // Room should now be "playing"
    const roomAfter = await request(app).get(`/api/rooms/${roomId}`);
    expect(roomAfter.body.status).toBe("playing");
    expect(roomAfter.body.gameId).toBe(gameId);

    // 5. Get initial state for both players
    const p0State = await request(app)
      .get(`/api/games/${gameId}/state`)
      .set("Authorization", `Bearer ${p0Token}`);
    expect(p0State.status).toBe(200);
    expect(p0State.body.version).toBe(0);
    expect(p0State.body.view.myPlayerId).toBe("player-0");
    expect(p0State.body.view.myHand).toHaveLength(6);
    expect(p0State.body.view.currentPlayer).toBe("player-0");

    const p1State = await request(app)
      .get(`/api/games/${gameId}/state`)
      .set("Authorization", `Bearer ${p1Token}`);
    expect(p1State.body.view.myPlayerId).toBe("player-1");
    expect(p1State.body.view.myHand).toHaveLength(6);

    // Players should have different hands
    expect(p0State.body.view.myHand).not.toEqual(p1State.body.view.myHand);

    // Spectator gets no hand
    const spectator = await request(app).get(`/api/games/${gameId}/state`);
    expect(spectator.body.view.myPlayerId).toBeNull();
    expect(spectator.body.view.myHand).toEqual([]);

    // 6. Player 0 plays a card face-down
    const cardId = p0State.body.view.myHand[0];
    const actionRes = await request(app)
      .post(`/api/games/${gameId}/action`)
      .set("Authorization", `Bearer ${p0Token}`)
      .send({ type: "play", cardId, theater: "land", faceUp: false });
    expect(actionRes.status).toBe(200);
    expect(actionRes.body.version).toBe(1);
    expect(actionRes.body.view.myHand).toHaveLength(5);
    expect(actionRes.body.view.currentPlayer).toBe("player-1");

    // 7. Player 1 sees the updated state (but not the face-down card)
    const p1After = await request(app)
      .get(`/api/games/${gameId}/state`)
      .set("Authorization", `Bearer ${p1Token}`);
    expect(p1After.body.view.currentPlayer).toBe("player-1");
    expect(p1After.body.view.opponentHandSize).toBe(5);
    const faceDownCard = p1After.body.view.theaters.land.stacks["player-0"][0];
    expect(faceDownCard.faceUp).toBe(false);
    expect(faceDownCard.cardId).toBeNull(); // hidden from opponent

    // 8. Player 1 plays a card
    const p1Card = p1After.body.view.myHand[0];
    const p1Action = await request(app)
      .post(`/api/games/${gameId}/action`)
      .set("Authorization", `Bearer ${p1Token}`)
      .send({ type: "play", cardId: p1Card, theater: "sea", faceUp: false });
    expect(p1Action.status).toBe(200);
    expect(p1Action.body.view.currentPlayer).toBe("player-0");
  });

  it("plays a full multi-round game to completion through HTTP", async () => {
    // Helper: play a card face-down for the current player
    async function playFaceDown(gId: string, token: string) {
      const state = await request(app)
        .get(`/api/games/${gId}/state`)
        .set("Authorization", `Bearer ${token}`);
      const cardId = state.body.view.myHand[0];
      const res = await request(app)
        .post(`/api/games/${gId}/action`)
        .set("Authorization", `Bearer ${token}`)
        .send({ type: "play", cardId, theater: "land", faceUp: false });
      expect(res.status).toBe(200);
      return res.body;
    }

    // Helper: get current state for a player
    async function getState(gId: string, token: string) {
      const res = await request(app)
        .get(`/api/games/${gId}/state`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      return res.body.view;
    }

    // 1. Create room and join
    const { body: { roomId } } = await request(app)
      .post("/api/rooms")
      .send({ gameType: "air-land-sea" });
    const { body: { token: t0 } } = await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .send({ playerId: "player-0", displayName: "Alice" });
    const { body: { token: t1 } } = await request(app)
      .post(`/api/rooms/${roomId}/join`)
      .send({ playerId: "player-1", displayName: "Bob" });
    const { body: { gameId } } = await request(app)
      .post(`/api/rooms/${roomId}/start`)
      .set("Authorization", `Bearer ${t0}`);

    const tokens = { "player-0": t0, "player-1": t1 };

    // 2. Play through multiple rounds via withdrawal until game over
    let gameOver = false;
    let roundsPlayed = 0;

    while (!gameOver && roundsPlayed < 10) {
      const state = await getState(gameId, t0);

      if (state.phase === "game-over") {
        gameOver = true;
        break;
      }

      if (state.phase === "round-over") {
        // Either player can start next round
        const res = await request(app)
          .post(`/api/games/${gameId}/action`)
          .set("Authorization", `Bearer ${t0}`)
          .send({ type: "start-next-round" });
        expect(res.status).toBe(200);
        expect(res.body.view.phase).toBe("playing");
        expect(res.body.view.myHand).toHaveLength(6);
        roundsPlayed++;
        continue;
      }

      // Play 2 cards each (face-down to avoid ability issues), then P0 withdraws
      // This gives the opponent 3 points per round (4 cards remaining)
      const currentState = await getState(gameId, tokens[state.currentPlayer as keyof typeof tokens]);
      const currentPlayer = currentState.currentPlayer;

      // Play 4 turns (2 per player)
      await playFaceDown(gameId, tokens["player-0"]);
      await playFaceDown(gameId, tokens["player-1"]);
      await playFaceDown(gameId, tokens["player-0"]);
      await playFaceDown(gameId, tokens["player-1"]);

      // P0 withdraws with 4 cards remaining → opponent scores 3
      const withdrawRes = await request(app)
        .post(`/api/games/${gameId}/action`)
        .set("Authorization", `Bearer ${t0}`)
        .send({ type: "withdraw" });
      expect(withdrawRes.status).toBe(200);
      expect(["round-over", "game-over"]).toContain(withdrawRes.body.view.phase);

      roundsPlayed++;
    }

    // 3. Verify game over
    const finalState = await getState(gameId, t0);
    expect(finalState.phase).toBe("game-over");

    // P1 should have won (P0 kept withdrawing)
    expect(finalState.scores["player-1"]).toBeGreaterThanOrEqual(12);

    // 4. Verify no more actions accepted
    const postGameAction = await request(app)
      .post(`/api/games/${gameId}/action`)
      .set("Authorization", `Bearer ${t0}`)
      .send({ type: "withdraw" });
    expect(postGameAction.status).toBe(400);

    // start-next-round should also be rejected
    const postGameStart = await request(app)
      .post(`/api/games/${gameId}/action`)
      .set("Authorization", `Bearer ${t0}`)
      .send({ type: "start-next-round" });
    expect(postGameStart.status).toBe(400);
  });
});
