/**
 * Tests for the game manager.
 *
 * These verify the boundary between the game manager and the game engine:
 * - Actions flow through validation → engine → DB persistence
 * - State can be rebuilt from the DB action log (cache miss / replay)
 * - Views are correctly filtered per player through the manager
 * - Invalid actions are rejected without side effects
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type Db } from "../db.js";
import { createGameManager, type GameManager } from "../game-manager.js";
import { alsGame } from "@card-games/shared/src/games/air-land-sea/index.js";
import type { ALSView } from "@card-games/shared/src/games/air-land-sea/types.js";

let db: Db;
let manager: GameManager;

beforeEach(() => {
  db = createDb(":memory:");
  manager = createGameManager(db, { "air-land-sea": alsGame });
});

/** Play a card face-down (safe — no abilities trigger, works to any theater). */
function playFaceDown(gameId: string, playerId: string) {
  const view = manager.getView(gameId, playerId) as ALSView;
  const cardId = view.myHand[0];
  manager.applyAction(gameId, playerId, {
    type: "play",
    cardId,
    theater: "land",
    faceUp: false,
  });
}

describe("game creation", () => {
  it("creates a game and stores it in the DB", () => {
    const roomId = db.createRoom("air-land-sea");
    const gameId = manager.createGame(roomId, "air-land-sea", 2);

    // Game should exist in DB
    const game = db.getGame(gameId);
    expect(game).not.toBeNull();
    expect(game!.gameType).toBe("air-land-sea");
    expect(game!.playerCount).toBe(2);
    expect(game!.baseSeed).toBeTypeOf("number");
  });

  it("returns an initial view after creation", () => {
    const roomId = db.createRoom("air-land-sea");
    const gameId = manager.createGame(roomId, "air-land-sea", 2);

    const view = manager.getView(gameId, "player-0") as ALSView;
    expect(view.myHand).toHaveLength(6);
    expect(view.phase).toBe("playing");
    expect(view.scores).toEqual({ "player-0": 0, "player-1": 0 });
  });

  it("throws for unknown game type", () => {
    const roomId = db.createRoom("unknown-game");
    expect(() => manager.createGame(roomId, "unknown-game", 2)).toThrow();
  });

  it("starts at version 0", () => {
    const roomId = db.createRoom("air-land-sea");
    const gameId = manager.createGame(roomId, "air-land-sea", 2);
    expect(manager.getVersion(gameId)).toBe(0);
  });
});

describe("applying actions", () => {
  it("applies a valid action and persists it to DB", () => {
    const roomId = db.createRoom("air-land-sea");
    const gameId = manager.createGame(roomId, "air-land-sea", 2);

    // Play face-down to avoid triggering abilities that create pending state
    playFaceDown(gameId, "player-0");

    // Action should be persisted
    const actions = db.getActions(gameId);
    expect(actions).toHaveLength(1);
    expect(actions[0].playerId).toBe("player-0");
    expect(actions[0].version).toBe(1);

    // State should reflect the action
    const newView = manager.getView(gameId, "player-0") as ALSView;
    expect(newView.myHand).toHaveLength(5);
    expect(newView.currentPlayer).toBe("player-1");
  });

  it("rejects invalid actions without persisting", () => {
    const roomId = db.createRoom("air-land-sea");
    const gameId = manager.createGame(roomId, "air-land-sea", 2);

    // player-1 tries to play on player-0's turn
    const view = manager.getView(gameId, "player-1") as ALSView;
    const cardId = view.myHand[0];

    expect(() =>
      manager.applyAction(gameId, "player-1", {
        type: "play",
        cardId,
        theater: "air",
        faceUp: false,
      }),
    ).toThrow();

    // No action should be persisted
    expect(db.getActions(gameId)).toHaveLength(0);
  });

  it("tracks version numbers sequentially", () => {
    const roomId = db.createRoom("air-land-sea");
    const gameId = manager.createGame(roomId, "air-land-sea", 2);

    // Play 3 turns face-down to avoid ability triggers
    playFaceDown(gameId, "player-0");
    playFaceDown(gameId, "player-1");
    playFaceDown(gameId, "player-0");

    const actions = db.getActions(gameId);
    expect(actions).toHaveLength(3);
    expect(actions.map((a) => a.version)).toEqual([1, 2, 3]);
  });
});

describe("view filtering", () => {
  it("returns different views for different players", () => {
    const roomId = db.createRoom("air-land-sea");
    const gameId = manager.createGame(roomId, "air-land-sea", 2);

    const p0View = manager.getView(gameId, "player-0") as ALSView;
    const p1View = manager.getView(gameId, "player-1") as ALSView;

    // Each player sees their own hand
    expect(p0View.myPlayerId).toBe("player-0");
    expect(p1View.myPlayerId).toBe("player-1");
    expect(p0View.myHand).not.toEqual(p1View.myHand);

    // Each sees opponent hand size
    expect(p0View.opponentHandSize).toBe(6);
    expect(p1View.opponentHandSize).toBe(6);
  });

  it("hides face-down card identities from opponent", () => {
    const roomId = db.createRoom("air-land-sea");
    const gameId = manager.createGame(roomId, "air-land-sea", 2);

    const p0View = manager.getView(gameId, "player-0") as ALSView;
    const cardId = p0View.myHand[0];

    // P0 plays face-down
    manager.applyAction(gameId, "player-0", {
      type: "play",
      cardId,
      theater: "land",
      faceUp: false,
    });

    // P0 should see their own face-down card
    const p0After = manager.getView(gameId, "player-0") as ALSView;
    const p0Card = p0After.theaters.land.stacks["player-0"][0];
    expect(p0Card.cardId).toBe(cardId);
    expect(p0Card.faceUp).toBe(false);

    // P1 should NOT see the card identity
    const p1After = manager.getView(gameId, "player-1") as ALSView;
    const p1Card = p1After.theaters.land.stacks["player-0"][0];
    expect(p1Card.cardId).toBeNull();
    expect(p1Card.faceUp).toBe(false);
  });

  it("returns spectator view with no hand info", () => {
    const roomId = db.createRoom("air-land-sea");
    const gameId = manager.createGame(roomId, "air-land-sea", 2);

    const spectator = manager.getSpectatorView(gameId) as ALSView;
    expect(spectator.myPlayerId).toBeNull();
    expect(spectator.myHand).toEqual([]);
  });
});

describe("cache eviction and replay", () => {
  it("rebuilds state from DB after cache eviction", () => {
    const roomId = db.createRoom("air-land-sea");
    const gameId = manager.createGame(roomId, "air-land-sea", 2);

    // Play a few turns face-down to avoid ability triggers
    for (let i = 0; i < 4; i++) {
      const playerId = i % 2 === 0 ? "player-0" : "player-1";
      playFaceDown(gameId, playerId);
    }

    // Capture all views before eviction
    const p0ViewBefore = manager.getView(gameId, "player-0") as ALSView;
    const p1ViewBefore = manager.getView(gameId, "player-1") as ALSView;
    const spectatorBefore = manager.getSpectatorView(gameId) as ALSView;
    const versionBefore = manager.getVersion(gameId);

    // Evict from cache — forces rebuild from DB on next access
    manager.evict(gameId);

    // All views should be identical after replay
    expect(manager.getView(gameId, "player-0")).toEqual(p0ViewBefore);
    expect(manager.getView(gameId, "player-1")).toEqual(p1ViewBefore);
    expect(manager.getSpectatorView(gameId)).toEqual(spectatorBefore);
    expect(manager.getVersion(gameId)).toBe(versionBefore);
  });

  it("replayed state accepts the next valid action", () => {
    const roomId = db.createRoom("air-land-sea");
    const gameId = manager.createGame(roomId, "air-land-sea", 2);

    // Play 2 turns face-down
    playFaceDown(gameId, "player-0");
    playFaceDown(gameId, "player-1");

    // Evict and replay
    manager.evict(gameId);

    // Should be able to continue playing (turn 3)
    expect(() => playFaceDown(gameId, "player-0")).not.toThrow();

    expect(db.getActions(gameId)).toHaveLength(3);
  });
});

describe("game lifecycle", () => {
  it("reports active players", () => {
    const roomId = db.createRoom("air-land-sea");
    const gameId = manager.createGame(roomId, "air-land-sea", 2);

    expect(manager.getActivePlayerIds(gameId)).toEqual(["player-0"]);

    playFaceDown(gameId, "player-0");

    expect(manager.getActivePlayerIds(gameId)).toEqual(["player-1"]);
  });

  it("detects game over after withdrawal", () => {
    const roomId = db.createRoom("air-land-sea");
    const gameId = manager.createGame(roomId, "air-land-sea", 2);

    // Withdraw repeatedly to accumulate points until game over
    for (let round = 0; round < 12; round++) {
      if (manager.getWinner(gameId) !== null) break;

      const view = manager.getView(gameId, "player-0") as ALSView;
      if (view.phase === "round-over") {
        manager.applyAction(gameId, "player-0", { type: "start-next-round" });
      }

      // Withdraw as whoever's turn it is
      const currentView = manager.getView(gameId, "player-0") as ALSView;
      manager.applyAction(gameId, currentView.currentPlayer, { type: "withdraw" });
    }

    expect(manager.getWinner(gameId)).not.toBeNull();
  });

  it("rejects actions after game is over", () => {
    const roomId = db.createRoom("air-land-sea");
    const gameId = manager.createGame(roomId, "air-land-sea", 2);

    // Drive to game-over via withdrawals
    for (let round = 0; round < 12; round++) {
      if (manager.getWinner(gameId) !== null) break;
      const view = manager.getView(gameId, "player-0") as ALSView;
      if (view.phase === "round-over") {
        manager.applyAction(gameId, "player-0", { type: "start-next-round" });
      }
      const currentView = manager.getView(gameId, "player-0") as ALSView;
      manager.applyAction(gameId, currentView.currentPlayer, { type: "withdraw" });
    }
    expect(manager.getWinner(gameId)).not.toBeNull();

    const actionsBefore = db.getActions(gameId).length;

    // Any action should be rejected
    expect(() =>
      manager.applyAction(gameId, "player-0", { type: "withdraw" }),
    ).toThrow();

    // No new action persisted
    expect(db.getActions(gameId)).toHaveLength(actionsBefore);
  });

  it("throws for actions on unknown game", () => {
    expect(() => manager.getView("nonexistent", "player-0")).toThrow();
    expect(() =>
      manager.applyAction("nonexistent", "player-0", { type: "withdraw" }),
    ).toThrow();
  });
});

describe("concurrent games", () => {
  it("two games do not interfere with each other", () => {
    const room1 = db.createRoom("air-land-sea");
    const room2 = db.createRoom("air-land-sea");
    const game1 = manager.createGame(room1, "air-land-sea", 2);
    const game2 = manager.createGame(room2, "air-land-sea", 2);

    // Play in game1
    playFaceDown(game1, "player-0");

    // Game1 should have 1 action, game2 should have 0
    expect(db.getActions(game1)).toHaveLength(1);
    expect(db.getActions(game2)).toHaveLength(0);

    // Game1 turn should advance, game2 should still be on player-0
    expect(manager.getActivePlayerIds(game1)).toEqual(["player-1"]);
    expect(manager.getActivePlayerIds(game2)).toEqual(["player-0"]);

    // Game2 player still has full hand
    const g2View = manager.getView(game2, "player-0") as ALSView;
    expect(g2View.myHand).toHaveLength(6);
  });
});

describe("cache edge cases", () => {
  it("evicting a nonexistent game does not throw", () => {
    expect(() => manager.evict("nonexistent")).not.toThrow();
  });

  it("evicting twice does not throw", () => {
    const roomId = db.createRoom("air-land-sea");
    const gameId = manager.createGame(roomId, "air-land-sea", 2);

    manager.evict(gameId);
    expect(() => manager.evict(gameId)).not.toThrow();
  });
});

describe("action listeners", () => {
  it("calls listener with gameId after a successful action", () => {
    const roomId = db.createRoom("air-land-sea");
    const gameId = manager.createGame(roomId, "air-land-sea", 2);

    const calls: string[] = [];
    manager.onAction((id) => calls.push(id));

    playFaceDown(gameId, "player-0");

    expect(calls).toEqual([gameId]);
  });

  it("does not call listener when action is rejected", () => {
    const roomId = db.createRoom("air-land-sea");
    const gameId = manager.createGame(roomId, "air-land-sea", 2);

    const calls: string[] = [];
    manager.onAction((id) => calls.push(id));

    // Wrong turn — should throw and not notify
    expect(() =>
      manager.applyAction(gameId, "player-1", { type: "withdraw" }),
    ).toThrow();

    expect(calls).toEqual([]);
  });

  it("calls multiple listeners", () => {
    const roomId = db.createRoom("air-land-sea");
    const gameId = manager.createGame(roomId, "air-land-sea", 2);

    const calls1: string[] = [];
    const calls2: string[] = [];
    manager.onAction((id) => calls1.push(id));
    manager.onAction((id) => calls2.push(id));

    playFaceDown(gameId, "player-0");

    expect(calls1).toEqual([gameId]);
    expect(calls2).toEqual([gameId]);
  });

  it("fires on each action in sequence", () => {
    const roomId = db.createRoom("air-land-sea");
    const gameId = manager.createGame(roomId, "air-land-sea", 2);

    const calls: string[] = [];
    manager.onAction((id) => calls.push(id));

    playFaceDown(gameId, "player-0");
    playFaceDown(gameId, "player-1");
    playFaceDown(gameId, "player-0");

    expect(calls).toEqual([gameId, gameId, gameId]);
  });
});
