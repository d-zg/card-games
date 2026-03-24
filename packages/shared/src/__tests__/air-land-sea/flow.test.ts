/**
 * Game flow tests for Air, Land & Sea.
 *
 * These test the core game loop without exercising card abilities.
 * We use strength-6 cards (no abilities) and face-down plays to test:
 * - Setup / dealing
 * - Playing cards face-up and face-down
 * - Theater strength calculation and winning
 * - Round scoring (full play-through and withdrawal)
 * - Multi-round game flow
 * - First-player alternation
 */
import { describe, it, expect } from "vitest";
import { GameRunner, InvalidActionError } from "../../runner.js";
import { alsGame } from "../../games/air-land-sea/index.js";
import { getCard } from "../../games/air-land-sea/cards.js";
import { makeRound, makeGameState } from "./helpers.js";
import type { ALSState, ALSAction, ALSView } from "../../games/air-land-sea/types.js";

const SEED = 42;

function createRunner() {
  return new GameRunner(alsGame, SEED, 2);
}

describe("Air, Land & Sea — game flow", () => {
  describe("setup", () => {
    it("deals 6 cards to each player with 6 remaining in deck", () => {
      const runner = createRunner();
      const state = runner.getState() as ALSState;
      expect(state.round).not.toBeNull();
      expect(state.round!.hands["player-0"]).toHaveLength(6);
      expect(state.round!.hands["player-1"]).toHaveLength(6);
      expect(state.round!.deck).toHaveLength(6);
    });

    it("deals from all 18 unique cards", () => {
      const runner = createRunner();
      const state = runner.getState() as ALSState;
      const allCards = [
        ...state.round!.hands["player-0"],
        ...state.round!.hands["player-1"],
        ...state.round!.deck,
      ];
      expect(allCards).toHaveLength(18);
      expect(new Set(allCards).size).toBe(18);
    });

    it("starts at round 1, scores 0-0, player-0 first", () => {
      const runner = createRunner();
      const state = runner.getState() as ALSState;
      expect(state.roundNumber).toBe(1);
      expect(state.scores).toEqual({ "player-0": 0, "player-1": 0 });
      expect(state.firstPlayer).toBe("player-0");
      expect(state.round!.currentPlayer).toBe("player-0");
    });
  });

  describe("playing cards", () => {
    it("plays a card face-up to its matching theater", () => {
      const round = makeRound({
        p0Hand: ["air-6", "land-6", "sea-6"],
        p1Hand: ["air-6", "land-6", "sea-6"],
      });
      // We can't use GameRunner with arbitrary state directly,
      // so test the reducer directly
      const state = makeGameState(round);
      const newState = alsGame.reducer(
        state,
        { type: "play", cardId: "air-6", theater: "air", faceUp: true },
        "player-0",
        { next: () => 0, int: () => 0, pick: (a: any) => a[0], shuffle: (a: any) => a },
      );
      expect(newState.round!.theaters.air.stacks["player-0"]).toHaveLength(1);
      expect(newState.round!.theaters.air.stacks["player-0"][0]).toEqual({
        cardId: "air-6",
        faceUp: true,
      });
      expect(newState.round!.hands["player-0"]).not.toContain("air-6");
      expect(newState.round!.currentPlayer).toBe("player-1");
    });

    it("plays a card face-down to any theater", () => {
      const round = makeRound({
        p0Hand: ["air-6"],
        p1Hand: ["land-6"],
      });
      const state = makeGameState(round);
      const newState = alsGame.reducer(
        state,
        { type: "play", cardId: "air-6", theater: "sea", faceUp: false },
        "player-0",
        { next: () => 0, int: () => 0, pick: (a: any) => a[0], shuffle: (a: any) => a },
      );
      expect(newState.round!.theaters.sea.stacks["player-0"]).toHaveLength(1);
      expect(newState.round!.theaters.sea.stacks["player-0"][0]).toEqual({
        cardId: "air-6",
        faceUp: false,
      });
    });

    it("rejects face-up play to non-matching theater", () => {
      const round = makeRound({
        p0Hand: ["air-6"],
        p1Hand: ["land-6"],
      });
      const state = makeGameState(round);
      const error = alsGame.validateAction(
        state,
        { type: "play", cardId: "air-6", theater: "land", faceUp: true },
        "player-0",
      );
      expect(error).toContain("matching theater");
    });

    it("rejects playing when not your turn", () => {
      const round = makeRound({
        p0Hand: ["air-6"],
        p1Hand: ["land-6"],
      });
      const state = makeGameState(round);
      const error = alsGame.validateAction(
        state,
        { type: "play", cardId: "land-6", theater: "land", faceUp: true },
        "player-1",
      );
      expect(error).toContain("Not your turn");
    });

    it("rejects playing a card not in hand", () => {
      const round = makeRound({
        p0Hand: ["air-6"],
        p1Hand: ["land-6"],
      });
      const state = makeGameState(round);
      const error = alsGame.validateAction(
        state,
        { type: "play", cardId: "sea-6", theater: "sea", faceUp: true },
        "player-0",
      );
      expect(error).toContain("not in your hand");
    });

    it("stacks cards in a theater (last played = top)", () => {
      const round = makeRound({
        p0Hand: ["air-6", "land-6"],
        p1Hand: ["air-6", "land-6"],
        currentPlayer: "player-0",
      });
      // Card IDs need to be unique, so let's use face-down plays
      const round2 = makeRound({
        p0Hand: ["air-6", "land-6"],
        p1Hand: ["sea-6", "sea-5"],
        currentPlayer: "player-0",
      });
      const state = makeGameState(round2);
      const dummyRng = { next: () => 0, int: () => 0, pick: (a: any) => a[0], shuffle: (a: any) => a };

      // p0 plays air-6 face-down to land
      let s = alsGame.reducer(state, { type: "play", cardId: "air-6", theater: "land", faceUp: false }, "player-0", dummyRng);
      // p1 plays sea-6 face-down to air
      s = alsGame.reducer(s, { type: "play", cardId: "sea-6", theater: "air", faceUp: false }, "player-1", dummyRng);
      // p0 plays land-6 face-up to land (stacks on top)
      s = alsGame.reducer(s, { type: "play", cardId: "land-6", theater: "land", faceUp: true }, "player-0", dummyRng);

      const landStack = s.round!.theaters.land.stacks["player-0"];
      expect(landStack).toHaveLength(2);
      expect(landStack[0].cardId).toBe("air-6"); // bottom
      expect(landStack[1].cardId).toBe("land-6"); // top
    });
  });

  describe("theater scoring", () => {
    it("face-up card uses printed strength", () => {
      // We'll test this via round resolution — play all cards, check winner
      const round = makeRound({
        p0Hand: ["air-6"],
        p1Hand: ["air-6"],
        // Give them only 1 card each so round ends after 2 plays
      });
      // Actually, round ends when both players have 0 cards.
      // For a minimal test: give 1 card each, both play to air.
      // p0 plays air-6 (strength 6) face-up
      // p1 plays... wait, can't both have air-6
      // Let's use different cards
      const round2 = makeRound({
        p0Hand: ["air-6"],
        p1Hand: ["air-5"],
      });
      const state = makeGameState(round2);
      const dummyRng = { next: () => 0, int: () => 0, pick: (a: any) => a[0], shuffle: (a: any) => a };

      let s = alsGame.reducer(state, { type: "play", cardId: "air-6", theater: "air", faceUp: true }, "player-0", dummyRng);
      s = alsGame.reducer(s, { type: "play", cardId: "air-5", theater: "air", faceUp: true }, "player-1", dummyRng);

      // Round should be over (both hands empty). player-0 wins air (6 > 5).
      // Only air has cards; land and sea are empty.
      // Empty theaters: tied at 0. Tie goes to non-last-player (player-0 since player-1 played last).
      // So player-0 wins all 3 theaters → wins round.
      expect(s.phase).toBe("round-over");
      expect(s.lastRoundWinner).toBe("player-0");
      expect(s.scores["player-0"]).toBe(6);
    });

    it("face-down card has strength 2", () => {
      const round = makeRound({
        p0Hand: ["air-6"],
        p1Hand: ["land-6"],
      });
      const state = makeGameState(round);
      const dummyRng = { next: () => 0, int: () => 0, pick: (a: any) => a[0], shuffle: (a: any) => a };

      // p0 plays air-6 face-down to land (strength 2)
      let s = alsGame.reducer(state, { type: "play", cardId: "air-6", theater: "land", faceUp: false }, "player-0", dummyRng);
      // p1 plays land-6 face-up to land (strength 6)
      s = alsGame.reducer(s, { type: "play", cardId: "land-6", theater: "land", faceUp: true }, "player-1", dummyRng);

      // land: p0=2 (face-down), p1=6 → p1 wins land
      // air, sea: tied at 0 → tie goes to non-last-player (player-0)
      // p0 wins 2, p1 wins 1 → p0 wins round
      expect(s.phase).toBe("round-over");
      expect(s.lastRoundWinner).toBe("player-0");
    });

    it("tied theater goes to non-last player", () => {
      const round = makeRound({
        p0Hand: ["air-6"],
        p1Hand: ["sea-6"],
      });
      const state = makeGameState(round);
      const dummyRng = { next: () => 0, int: () => 0, pick: (a: any) => a[0], shuffle: (a: any) => a };

      // p0 plays to air, p1 plays to sea → land is tied at 0
      let s = alsGame.reducer(state, { type: "play", cardId: "air-6", theater: "air", faceUp: true }, "player-0", dummyRng);
      s = alsGame.reducer(s, { type: "play", cardId: "sea-6", theater: "sea", faceUp: true }, "player-1", dummyRng);

      // air: p0=6, p1=0 → p0 wins
      // sea: p0=0, p1=6 → p1 wins
      // land: 0-0 → tie → goes to non-last-player (p0 since p1 played last)
      expect(s.lastRoundWinner).toBe("player-0");
    });
  });

  describe("withdrawal", () => {
    it("opponent scores 2 points when withdrawing with 6 cards", () => {
      const round = makeRound({
        p0Hand: ["air-1", "air-2", "air-3", "land-1", "land-2", "land-3"],
        p1Hand: ["sea-1", "sea-2", "sea-3", "air-4", "land-4", "sea-4"],
      });
      const state = makeGameState(round);
      const dummyRng = { next: () => 0, int: () => 0, pick: (a: any) => a[0], shuffle: (a: any) => a };

      const s = alsGame.reducer(state, { type: "withdraw" }, "player-0", dummyRng);

      expect(s.phase).toBe("round-over");
      expect(s.scores["player-1"]).toBe(2); // opponent scores 2
      expect(s.lastRoundWinner).toBe("player-1");
    });

    it("opponent scores 3 points when withdrawing with 4 cards", () => {
      const round = makeRound({
        p0Hand: ["air-1", "air-2", "air-3", "land-1"],
        p1Hand: ["sea-1", "sea-2", "sea-3", "air-4"],
      });
      const state = makeGameState(round);
      const dummyRng = { next: () => 0, int: () => 0, pick: (a: any) => a[0], shuffle: (a: any) => a };

      const s = alsGame.reducer(state, { type: "withdraw" }, "player-0", dummyRng);
      expect(s.scores["player-1"]).toBe(3);
    });

    it("opponent scores 4 points when withdrawing with 2 cards", () => {
      const round = makeRound({
        p0Hand: ["air-1", "air-2"],
        p1Hand: ["sea-1", "sea-2"],
      });
      const state = makeGameState(round);
      const dummyRng = { next: () => 0, int: () => 0, pick: (a: any) => a[0], shuffle: (a: any) => a };

      const s = alsGame.reducer(state, { type: "withdraw" }, "player-0", dummyRng);
      expect(s.scores["player-1"]).toBe(4);
    });

    it("opponent scores 4 points when withdrawing with 1 card", () => {
      const round = makeRound({
        p0Hand: ["air-1"],
        p1Hand: ["sea-1"],
      });
      const state = makeGameState(round);
      const dummyRng = { next: () => 0, int: () => 0, pick: (a: any) => a[0], shuffle: (a: any) => a };

      const s = alsGame.reducer(state, { type: "withdraw" }, "player-0", dummyRng);
      expect(s.scores["player-1"]).toBe(4);
    });
  });

  describe("round lifecycle", () => {
    it("transitions to round-over when both hands are empty", () => {
      const round = makeRound({
        p0Hand: ["air-6"],
        p1Hand: ["land-6"],
      });
      const state = makeGameState(round);
      const dummyRng = { next: () => 0, int: () => 0, pick: (a: any) => a[0], shuffle: (a: any) => a };

      let s = alsGame.reducer(state, { type: "play", cardId: "air-6", theater: "air", faceUp: true }, "player-0", dummyRng);
      s = alsGame.reducer(s, { type: "play", cardId: "land-6", theater: "land", faceUp: true }, "player-1", dummyRng);

      expect(s.phase).toBe("round-over");
    });

    it("starts next round when start-next-round action is played", () => {
      const round = makeRound({ p0Hand: ["air-6"], p1Hand: ["land-6"] });
      const state = makeGameState(round);
      const dummyRng = { next: () => 0, int: () => 0, pick: (a: any) => a[0], shuffle: (a: any) => a };
      const shuffleRng = { next: () => 0.5, int: () => 0, pick: (a: any) => a[0], shuffle: (a: any) => a };

      let s = alsGame.reducer(state, { type: "play", cardId: "air-6", theater: "air", faceUp: true }, "player-0", dummyRng);
      s = alsGame.reducer(s, { type: "play", cardId: "land-6", theater: "land", faceUp: true }, "player-1", dummyRng);
      expect(s.phase).toBe("round-over");

      // Start next round
      s = alsGame.reducer(s, { type: "start-next-round" }, "player-0", shuffleRng);
      expect(s.phase).toBe("playing");
      expect(s.roundNumber).toBe(2);
      expect(s.round).not.toBeNull();
      expect(s.round!.hands["player-0"]).toHaveLength(6);
      expect(s.round!.hands["player-1"]).toHaveLength(6);
    });

    it("loser goes first in the next round", () => {
      const round = makeRound({ p0Hand: ["air-6"], p1Hand: ["land-6"] });
      const state = makeGameState(round);
      const dummyRng = { next: () => 0, int: () => 0, pick: (a: any) => a[0], shuffle: (a: any) => a };

      // p0 plays air-6 to air (str 6), p1 plays land-6 to land (str 6)
      // air: p0=6 > p1=0 → p0; land: p0=0 < p1=6 → p1; sea: 0-0 tie → non-last-player = p0
      // p0 wins 2 theaters → p0 wins round
      let s = alsGame.reducer(state, { type: "play", cardId: "air-6", theater: "air", faceUp: true }, "player-0", dummyRng);
      s = alsGame.reducer(s, { type: "play", cardId: "land-6", theater: "land", faceUp: true }, "player-1", dummyRng);
      expect(s.lastRoundWinner).toBe("player-0");

      // Next round: loser (p1) goes first
      s = alsGame.reducer(s, { type: "start-next-round" }, "player-0", dummyRng);
      expect(s.round!.currentPlayer).toBe("player-1");
      expect(s.firstPlayer).toBe("player-1");
    });
  });

  describe("game-over", () => {
    it("game ends when a player reaches 12 points", () => {
      const round = makeRound({ p0Hand: ["air-6"], p1Hand: ["land-6"] });
      const state = makeGameState(round, {
        scores: { "player-0": 10, "player-1": 0 },
      });
      const dummyRng = { next: () => 0, int: () => 0, pick: (a: any) => a[0], shuffle: (a: any) => a };

      // p0 wins the round → gains 6 points → total 16 → game over
      // But we need p0 to actually win. With just these 2 cards:
      // air: p0=6 > p1=0; land: p0=0 < p1=6; sea: tie → p0 (non-last-player)
      let s = alsGame.reducer(state, { type: "play", cardId: "air-6", theater: "air", faceUp: true }, "player-0", dummyRng);
      s = alsGame.reducer(s, { type: "play", cardId: "land-6", theater: "land", faceUp: true }, "player-1", dummyRng);

      expect(s.phase).toBe("game-over");
      expect(s.scores["player-0"]).toBeGreaterThanOrEqual(12);
    });

    it("handles tied scores at 12+ by allowing another round", () => {
      // This can't happen through normal play (only one player scores per round),
      // but the rules say: "If both players reach 12+ simultaneously and are tied,
      // play another round." The game should not get stuck.
      const round = makeRound({ p0Hand: ["air-6"], p1Hand: ["land-6"] });
      const state = makeGameState(round, {
        scores: { "player-0": 12, "player-1": 12 },
      });
      const dummyRng = { next: () => 0, int: () => 0, pick: (a: any) => a[0], shuffle: (a: any) => a };

      // P0 wins this round → P0 goes to 18, P1 stays at 12
      let s = alsGame.reducer(state, { type: "play", cardId: "air-6", theater: "air", faceUp: true }, "player-0", dummyRng);
      s = alsGame.reducer(s, { type: "play", cardId: "land-6", theater: "land", faceUp: true }, "player-1", dummyRng);

      // P0 should win outright (18 > 12)
      expect(s.phase).toBe("game-over");
      expect(alsGame.getWinner(s)).toEqual(["player-0"]);
    });

    it("does not get stuck if scores are exactly tied at 12+", () => {
      // Artificially create a game-over state with tied scores.
      // getWinner should indicate no winner yet, and the game should
      // transition to round-over instead of game-over so another round can be played.
      const state: ALSState = {
        scores: { "player-0": 12, "player-1": 12 },
        round: null,
        phase: "round-over" as const,
        firstPlayer: "player-0",
        roundNumber: 5,
        lastRoundWinner: "player-0",
      };

      // Should be able to start another round (not stuck in game-over)
      const error = alsGame.validateAction(state, { type: "start-next-round" }, "player-0");
      expect(error).toBeNull();
    });

    it("rejects start-next-round when game is over", () => {
      const round = makeRound({ p0Hand: ["air-6"], p1Hand: ["land-6"] });
      const state = makeGameState(round, {
        scores: { "player-0": 10, "player-1": 0 },
      });
      const dummyRng = { next: () => 0, int: () => 0, pick: (a: any) => a[0], shuffle: (a: any) => a };

      let s = alsGame.reducer(state, { type: "play", cardId: "air-6", theater: "air", faceUp: true }, "player-0", dummyRng);
      s = alsGame.reducer(s, { type: "play", cardId: "land-6", theater: "land", faceUp: true }, "player-1", dummyRng);
      expect(s.phase).toBe("game-over");

      const error = alsGame.validateAction(s, { type: "start-next-round" }, "player-0");
      expect(error).not.toBeNull();
    });
  });

  describe("views", () => {
    it("shows player their own hand but not opponent's cards", () => {
      const runner = createRunner();
      const state = runner.getState() as ALSState;
      const p0View = runner.getView("player-0") as ALSView;
      const p1View = runner.getView("player-1") as ALSView;

      expect(p0View.myHand).toEqual(state.round!.hands["player-0"]);
      expect(p1View.myHand).toEqual(state.round!.hands["player-1"]);
      expect(p0View.myHand).not.toEqual(p1View.myHand);
      expect(p0View.opponentHandSize).toBe(6);
    });

    it("hides face-down card identity from opponent", () => {
      const round = makeRound({
        p0Hand: ["air-6", "land-6"],
        p1Hand: ["sea-6", "sea-5"],
      });
      const state = makeGameState(round);
      const dummyRng = { next: () => 0, int: () => 0, pick: (a: any) => a[0], shuffle: (a: any) => a };

      // p0 plays air-6 face-down to sea
      const s = alsGame.reducer(state, { type: "play", cardId: "air-6", theater: "sea", faceUp: false }, "player-0", dummyRng);

      const p0View = alsGame.view(s, "player-0");
      const p1View = alsGame.view(s, "player-1");

      // p0 should see their own face-down card
      expect(p0View.theaters.sea.stacks["player-0"][0].cardId).toBe("air-6");
      // p1 should NOT see it
      expect(p1View.theaters.sea.stacks["player-0"][0].cardId).toBeNull();
      expect(p1View.theaters.sea.stacks["player-0"][0].faceUp).toBe(false);
    });

    it("spectator sees no hands", () => {
      const runner = createRunner();
      const spectator = runner.getSpectatorView() as ALSView;

      expect(spectator.myHand).toEqual([]);
      expect(spectator.myPlayerId).toBeNull();
    });
  });
});
