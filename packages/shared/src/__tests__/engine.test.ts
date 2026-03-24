import { describe, it, expect } from "vitest";
import { GameRunner, InvalidActionError } from "../runner.js";
import { createRng } from "../random.js";
import { warGame } from "./test-game.js";
import type { WarAction } from "./test-game.js";

const SEED = 42;

function createWarRunner() {
  return new GameRunner(warGame, SEED, 2);
}

describe("GameRunner", () => {
  describe("setup", () => {
    it("creates initial state with correct player hands", () => {
      const runner = createWarRunner();
      const state = runner.getState();
      expect(state.hands["player-0"]).toHaveLength(5);
      expect(state.hands["player-1"]).toHaveLength(5);
      expect(state.phase).toBe("playing");
      expect(state.currentPlayer).toBe("player-0");
    });

    it("deals all 10 cards with no duplicates", () => {
      const runner = createWarRunner();
      const state = runner.getState();
      const allCards = [
        ...state.hands["player-0"],
        ...state.hands["player-1"],
      ].sort((a, b) => a - b);
      expect(allCards).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it("starts at version 0 with empty action log", () => {
      const runner = createWarRunner();
      expect(runner.getVersion()).toBe(0);
      expect(runner.getActionLog()).toEqual([]);
    });

    it("rejects player count above maxPlayers", () => {
      expect(() => new GameRunner(warGame, SEED, 3)).toThrow();
    });

    it("rejects player count below minPlayers", () => {
      expect(() => new GameRunner(warGame, SEED, 1)).toThrow();
    });
  });

  describe("actions", () => {
    it("accepts valid actions and advances state", () => {
      const runner = createWarRunner();
      const hand = runner.getState().hands["player-0"];
      const card = hand[0];

      runner.applyAction("player-0", { type: "play-card", card });

      expect(runner.getVersion()).toBe(1);
      expect(runner.getState().hands["player-0"]).not.toContain(card);
      expect(runner.getState().currentPlayer).toBe("player-1");
    });

    it("rejects actions when it's not your turn", () => {
      const runner = createWarRunner();
      const hand = runner.getState().hands["player-1"];

      expect(() => {
        runner.applyAction("player-1", { type: "play-card", card: hand[0] });
      }).toThrow(InvalidActionError);
    });

    it("rejects playing a card you don't have", () => {
      const runner = createWarRunner();

      expect(() => {
        runner.applyAction("player-0", { type: "play-card", card: 99 });
      }).toThrow("You don't have that card");
    });

    it("rejects actions after game is over", () => {
      const runner = playToCompletion();
      const winner = runner.getWinner()!;
      expect(winner).not.toBeNull();

      // Try to play after game ends
      expect(() => {
        runner.applyAction("player-0", { type: "play-card", card: 1 });
      }).toThrow("Game is over");
    });

    it("resolves a round when both players play", () => {
      const runner = createWarRunner();
      const p0Hand = runner.getState().hands["player-0"];
      const p1Hand = runner.getState().hands["player-1"];

      runner.applyAction("player-0", { type: "play-card", card: p0Hand[0] });
      runner.applyAction("player-1", { type: "play-card", card: p1Hand[0] });

      const state = runner.getState();
      expect(state.lastRound).not.toBeNull();
      expect(state.lastRound!.card0).toBe(p0Hand[0]);
      expect(state.lastRound!.card1).toBe(p1Hand[0]);
      expect(["player-0", "player-1"]).toContain(state.lastRound!.winner);
    });
  });

  describe("views", () => {
    it("shows player their own hand", () => {
      const runner = createWarRunner();
      const state = runner.getState();
      const view = runner.getView("player-0");

      expect(view.myHand).toEqual(state.hands["player-0"]);
    });

    it("hides opponent hand size only", () => {
      const runner = createWarRunner();
      const view = runner.getView("player-0");

      expect(view.opponentHandSize).toBe(5);
      // myHand should NOT contain opponent's cards
      expect(view.myHand).toHaveLength(5);
    });

    it("does not leak opponent's specific cards", () => {
      const runner = createWarRunner();
      const p0View = runner.getView("player-0");
      const p1View = runner.getView("player-1");

      // Each player sees their own hand but not the other's
      expect(p0View.myHand).not.toEqual(p1View.myHand);
      // Neither view object has the raw hands from state
      expect(p0View).not.toHaveProperty("hands");
    });

    it("shows 'waiting' when opponent has played", () => {
      const runner = createWarRunner();
      const p0Hand = runner.getState().hands["player-0"];

      runner.applyAction("player-0", { type: "play-card", card: p0Hand[0] });

      const p1View = runner.getView("player-1");
      expect(p1View.currentPlay).toBe("waiting");

      // Player 0 should NOT see "waiting" (they already played)
      const p0View = runner.getView("player-0");
      expect(p0View.currentPlay).toBeNull();
    });
  });

  describe("spectator view", () => {
    it("shows no hand information", () => {
      const runner = createWarRunner();
      const spectator = runner.getSpectatorView();

      expect(spectator.myHand).toBeNull();
    });

    it("shows game progress", () => {
      const runner = createWarRunner();
      const spectator = runner.getSpectatorView();

      expect(spectator.wins).toEqual({ "player-0": 0, "player-1": 0 });
      expect(spectator.phase).toBe("playing");
      expect(spectator.currentPlayer).toBe("player-0");
    });
  });

  describe("winner detection", () => {
    it("returns null while game is in progress", () => {
      const runner = createWarRunner();
      expect(runner.getWinner()).toBeNull();
    });

    it("detects winner after 3 round wins", () => {
      const runner = playToCompletion();
      const winner = runner.getWinner();

      expect(winner).not.toBeNull();
      expect(winner).toHaveLength(1);
      expect(["player-0", "player-1"]).toContain(winner![0]);
    });
  });

  describe("active players", () => {
    it("returns current player during game", () => {
      const runner = createWarRunner();
      expect(runner.getActivePlayerIds()).toEqual(["player-0"]);
    });

    it("alternates between players", () => {
      const runner = createWarRunner();
      const p0Hand = runner.getState().hands["player-0"];

      runner.applyAction("player-0", { type: "play-card", card: p0Hand[0] });
      expect(runner.getActivePlayerIds()).toEqual(["player-1"]);
    });

    it("returns empty when game is over", () => {
      const runner = playToCompletion();
      expect(runner.getActivePlayerIds()).toEqual([]);
    });
  });

  describe("deterministic replay", () => {
    it("produces identical state from same seed and actions", () => {
      const runner1 = createWarRunner();
      const actions = playFullGame(runner1);

      const runner2 = GameRunner.replay(warGame, SEED, 2, actions);

      expect(runner2.getState()).toEqual(runner1.getState());
      expect(runner2.getVersion()).toBe(runner1.getVersion());
      expect(runner2.getWinner()).toEqual(runner1.getWinner());
    });

    it("produces different state from different seeds", () => {
      const runner1 = new GameRunner(warGame, 1, 2);
      const runner2 = new GameRunner(warGame, 2, 2);

      // Different seeds should produce different hands
      expect(runner1.getState().hands["player-0"]).not.toEqual(
        runner2.getState().hands["player-0"],
      );
    });
  });

  describe("RNG determinism", () => {
    it("same seed produces same sequence", () => {
      const rng1 = createRng(42);
      const rng2 = createRng(42);

      const seq1 = Array.from({ length: 10 }, () => rng1.next());
      const seq2 = Array.from({ length: 10 }, () => rng2.next());

      expect(seq1).toEqual(seq2);
    });

    it("shuffle is deterministic", () => {
      const arr1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const arr2 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

      createRng(42).shuffle(arr1);
      createRng(42).shuffle(arr2);

      expect(arr1).toEqual(arr2);
    });

    it("int produces values in range", () => {
      const rng = createRng(42);
      for (let i = 0; i < 100; i++) {
        const val = rng.int(0, 10);
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(10);
      }
    });

    it("pick returns elements from the array", () => {
      const rng = createRng(42);
      const arr = ["a", "b", "c"];
      for (let i = 0; i < 20; i++) {
        expect(arr).toContain(rng.pick(arr));
      }
    });

    it("pick throws on empty array", () => {
      const rng = createRng(42);
      expect(() => rng.pick([])).toThrow("Cannot pick from empty array");
    });
  });
});

/** Play cards alternating until someone wins 3 rounds. */
function playToCompletion(): GameRunner<any, any, any> {
  const runner = createWarRunner();
  playFullGame(runner);
  return runner;
}

/** Play a full game, returning the action log for replay tests. */
function playFullGame(
  runner: GameRunner<any, any, any>,
): { playerId: string; action: WarAction }[] {
  const actions: { playerId: string; action: WarAction }[] = [];

  while (runner.getWinner() === null) {
    const state = runner.getState();
    const playerId = state.currentPlayer;
    const hand = state.hands[playerId];
    const action: WarAction = { type: "play-card", card: hand[0] };
    actions.push({ playerId, action });
    runner.applyAction(playerId, action);
  }

  return actions;
}
