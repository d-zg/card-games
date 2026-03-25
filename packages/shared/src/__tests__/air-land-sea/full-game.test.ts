/**
 * Full game simulation for Air, Land & Sea.
 *
 * 3 rounds exercising: face-up/face-down play, withdrawal scoring,
 * Escalation, Support, Ambush, Maneuver, Cover Fire, Containment,
 * theater scoring, round lifecycle, first-player alternation, and game-over.
 */
import { describe, it, expect } from "vitest";
import { alsGame } from "../../games/air-land-sea/index.js";
import { makeRound, makeGameState } from "./helpers.js";
import type { ALSState, ALSAction, ALSView } from "../../games/air-land-sea/types.js";
import type { SeededRng } from "../../random.js";

const noopRng: SeededRng = {
  next: () => 0,
  int: () => 0,
  pick: (a) => a[0],
  shuffle: (a) => a,
};

function apply(state: ALSState, action: ALSAction, playerId: string): ALSState {
  const error = alsGame.validateAction(state, action, playerId);
  if (error) throw new Error(`Invalid action: ${error}`);
  return alsGame.reducer(state, action, playerId, noopRng);
}

describe("Air, Land & Sea — full game simulation", () => {
  it("plays a complete 3-round game to victory", () => {
    // ============================================================
    // ROUND 1: P0 goes first. P1 withdraws after seeing P0's power.
    // P0 scores 3 points.
    // ============================================================
    let state = makeGameState(
      makeRound({
        p0Hand: ["air-6", "land-6", "sea-6", "air-1", "land-1", "sea-1"],
        p1Hand: ["air-4", "land-4", "sea-4", "air-3", "land-3", "sea-3"],
        currentPlayer: "player-0",
      }),
      { scores: { "player-0": 0, "player-1": 0 }, roundNumber: 1 },
    );

    // -- Turn 1 (P0): Play air-6 face-up to air --
    // Heavy Bomber, str 6, no ability.
    state = apply(state, { type: "play", cardId: "air-6", theater: "air", faceUp: true }, "player-0");
    expect(state.round!.theaters.air.stacks["player-0"]).toEqual([
      { cardId: "air-6", faceUp: true },
    ]);
    expect(state.round!.hands["player-0"]).toHaveLength(5);
    expect(state.round!.currentPlayer).toBe("player-1");

    // -- Turn 2 (P1): Play air-3 face-down to air --
    // Face-down: str 2, Maneuver ability does NOT trigger.
    state = apply(state, { type: "play", cardId: "air-3", theater: "air", faceUp: false }, "player-1");
    expect(state.round!.theaters.air.stacks["player-1"]).toEqual([
      { cardId: "air-3", faceUp: false },
    ]);
    // P0's view should NOT see the card identity
    const p0ViewR1 = alsGame.view(state, "player-0");
    expect(p0ViewR1.theaters.air.stacks["player-1"][0].cardId).toBeNull();
    // P1's view SHOULD see their own face-down card
    const p1ViewR1 = alsGame.view(state, "player-1");
    expect(p1ViewR1.theaters.air.stacks["player-1"][0].cardId).toBe("air-3");

    // -- Turn 3 (P0): Play land-6 face-up to land --
    state = apply(state, { type: "play", cardId: "land-6", theater: "land", faceUp: true }, "player-0");

    // -- Turn 4 (P1): Play land-3 face-down to land --
    state = apply(state, { type: "play", cardId: "land-3", theater: "land", faceUp: false }, "player-1");

    // -- Turn 5 (P0): Play sea-6 face-up to sea --
    state = apply(state, { type: "play", cardId: "sea-6", theater: "sea", faceUp: true }, "player-0");

    // -- Turn 6 (P1): Withdraws with 4 cards remaining --
    // P1 played 2 cards (air-3, land-3), so 4 remain. 4 cards = 3 points for P0.
    expect(state.round!.hands["player-1"]).toHaveLength(4);
    state = apply(state, { type: "withdraw" }, "player-1");

    expect(state.phase).toBe("round-over");
    expect(state.scores).toEqual({ "player-0": 3, "player-1": 0 });
    expect(state.lastRoundWinner).toBe("player-0");
    expect(state.round).toBeNull();

    // ============================================================
    // ROUND 2: P1 goes first (first player alternates).
    // Full play-through with abilities. P0 wins, scores 6.
    // Abilities used: Escalation, Support, Ambush, Maneuver (x2),
    //   Cover Fire.
    // ============================================================
    state = {
      ...state,
      round: makeRound({
        p1Hand: ["sea-2", "air-1", "land-2", "air-4", "land-4", "sea-3"],
        p0Hand: ["air-6", "land-6", "sea-6", "land-3", "air-2", "sea-4"],
        deck: ["air-3", "air-5", "land-1", "land-5", "sea-1", "sea-5"],
        currentPlayer: "player-1",
      }),
      phase: "playing" as const,
      roundNumber: 2,
      firstPlayer: "player-1",
    };

    // -- Turn 1 (P1): Play sea-2 (Escalation) face-up to sea --
    // Ongoing: P1's face-down cards are strength 4 instead of 2.
    state = apply(state, { type: "play", cardId: "sea-2", theater: "sea", faceUp: true }, "player-1");
    expect(state.round!.theaters.sea.stacks["player-1"]).toEqual([
      { cardId: "sea-2", faceUp: true },
    ]);

    // -- Turn 2 (P0): Play air-6 face-up to air --
    state = apply(state, { type: "play", cardId: "air-6", theater: "air", faceUp: true }, "player-0");

    // -- Turn 3 (P1): Play air-1 (Support) face-up to air --
    // Ongoing: +3 to P1's strength in adjacent theaters (land).
    state = apply(state, { type: "play", cardId: "air-1", theater: "air", faceUp: true }, "player-1");

    // Verify Support gives +3 to P1's land strength (even with nothing in land yet)
    let view = alsGame.view(state, "player-0");
    expect(view.theaterStrengths.land["player-1"]).toBe(3); // just the +3 bonus

    // -- Turn 4 (P0): Play land-6 face-up to land --
    state = apply(state, { type: "play", cardId: "land-6", theater: "land", faceUp: true }, "player-0");
    view = alsGame.view(state, "player-0");
    expect(view.theaterStrengths.land["player-0"]).toBe(6);

    // -- Turn 5 (P1): Play land-2 (Ambush) face-up to land --
    // Instant: flip any card in any theater.
    state = apply(state, { type: "play", cardId: "land-2", theater: "land", faceUp: true }, "player-1");
    expect(state.round!.pendingAbility).toEqual({ type: "ambush", playerId: "player-1" });

    // P1 uses Ambush to flip P0's land-6 face-down: str 6 → str 2. Big swing!
    state = apply(state, {
      type: "choose-flip", theater: "land", cardOwner: "player-0", cardIndex: 0,
    }, "player-1");
    expect(state.round!.theaters.land.stacks["player-0"][0].faceUp).toBe(false);
    expect(state.round!.pendingAbility).toBeNull();
    view = alsGame.view(state, "player-0");
    expect(view.theaterStrengths.land["player-0"]).toBe(2); // was 6, now 2

    // -- Turn 6 (P0): Play land-3 (Maneuver) face-up to land --
    // Instant: flip a card in adjacent theater (air or sea).
    state = apply(state, { type: "play", cardId: "land-3", theater: "land", faceUp: true }, "player-0");
    expect(state.round!.pendingAbility!.type).toBe("maneuver");

    // P0 flips P1's sea-2 (Escalation) face-down — deactivating Escalation!
    state = apply(state, {
      type: "choose-flip", theater: "sea", cardOwner: "player-1", cardIndex: 0,
    }, "player-0");
    expect(state.round!.theaters.sea.stacks["player-1"][0].faceUp).toBe(false);

    // -- Turn 7 (P1): Play air-4 face-down to sea --
    // Escalation is OFF, so face-down = str 2.
    state = apply(state, { type: "play", cardId: "air-4", theater: "sea", faceUp: false }, "player-1");
    view = alsGame.view(state, "player-0");
    expect(view.theaterStrengths.sea["player-1"]).toBe(4); // sea-2↓(2) + air-4↓(2)

    // -- Turn 8 (P0): Play sea-6 face-up to sea --
    state = apply(state, { type: "play", cardId: "sea-6", theater: "sea", faceUp: true }, "player-0");
    view = alsGame.view(state, "player-0");
    expect(view.theaterStrengths.sea["player-0"]).toBe(6);

    // -- Turn 9 (P1): Play land-4 (Cover Fire) face-up to land --
    // Ongoing: cards covered by Cover Fire become str 4.
    // land-2 (underneath) goes from str 2 → str 4.
    state = apply(state, { type: "play", cardId: "land-4", theater: "land", faceUp: true }, "player-1");
    view = alsGame.view(state, "player-0");
    // P1 land: land-2↑(4, covered by Cover Fire) + land-4↑(4) + Support(+3) = 11
    expect(view.theaterStrengths.land["player-1"]).toBe(11);

    // -- Turn 10 (P0): Play air-2 face-down to air --
    state = apply(state, { type: "play", cardId: "air-2", theater: "air", faceUp: false }, "player-0");

    // -- Turn 11 (P1): Play sea-3 (Maneuver) face-up to sea --
    // Instant: flip in adjacent theater (land).
    state = apply(state, { type: "play", cardId: "sea-3", theater: "sea", faceUp: true }, "player-1");
    expect(state.round!.pendingAbility!.type).toBe("maneuver");

    // P1 flips P0's land-3 face-down: str 3 → str 2.
    state = apply(state, {
      type: "choose-flip", theater: "land", cardOwner: "player-0", cardIndex: 1,
    }, "player-1");
    expect(state.round!.theaters.land.stacks["player-0"][1].faceUp).toBe(false);

    // -- Turn 12 (P0): Play sea-4 face-down to sea --
    // Last card for both players. Round ends after this.
    state = apply(state, { type: "play", cardId: "sea-4", theater: "sea", faceUp: false }, "player-0");

    // Round should be over — both hands empty.
    // Final strengths:
    //   Air: P0 = air-6↑(6) + air-2↓(2) = 8  vs  P1 = air-1↑(1) = 1   → P0 wins
    //   Land: P0 = land-6↓(2) + land-3↓(2) = 4  vs  P1 = 4 + 4 + 3 = 11  → P1 wins
    //   Sea: P0 = sea-6↑(6) + sea-4↓(2) = 8  vs  P1 = sea-2↓(2) + air-4↓(2) + sea-3↑(3) = 7  → P0 wins
    // P0 wins 2 of 3 → scores 6 points.
    expect(state.phase).toBe("round-over");
    expect(state.scores).toEqual({ "player-0": 9, "player-1": 0 });
    expect(state.lastRoundWinner).toBe("player-0");

    // ============================================================
    // ROUND 3: P0 goes first (alternation: R1=P0, R2=P1, R3=P0).
    // Containment showcase, then P1 withdraws.
    // P1 is 2nd player, withdraws with 4 cards → 3 pts to P0.
    // P0 total: 9 + 3 = 12. Game over.
    // ============================================================
    state = {
      ...state,
      round: makeRound({
        p1Hand: ["air-5", "sea-5", "air-2", "land-2", "sea-2", "land-5"],
        p0Hand: ["air-6", "land-6", "sea-6", "air-1", "land-1", "sea-1"],
        deck: ["air-3", "air-4", "land-3", "land-4", "sea-3", "sea-4"],
        currentPlayer: "player-0",
      }),
      phase: "playing" as const,
      roundNumber: 3,
      firstPlayer: "player-0",
    };

    // -- Turn 1 (P0): Play air-6 face-up to air --
    state = apply(state, { type: "play", cardId: "air-6", theater: "air", faceUp: true }, "player-0");

    // -- Turn 2 (P1): Play air-5 (Containment) face-up to air --
    // Ongoing: any card played face-down is immediately discarded.
    state = apply(state, { type: "play", cardId: "air-5", theater: "air", faceUp: true }, "player-1");

    // -- Turn 3 (P0): Play sea-6 face-DOWN to land --
    // Containment is active → card is discarded!
    const deckSizeBefore = state.round!.deck.length;
    state = apply(state, { type: "play", cardId: "sea-6", theater: "land", faceUp: false }, "player-0");

    // sea-6 should NOT be in the land theater — it was discarded.
    expect(state.round!.theaters.land.stacks["player-0"]).toHaveLength(0);
    // Card was removed from hand
    expect(state.round!.hands["player-0"]).not.toContain("sea-6");
    // Card went to bottom of deck
    expect(state.round!.deck).toHaveLength(deckSizeBefore + 1);
    expect(state.round!.deck[state.round!.deck.length - 1]).toBe("sea-6");

    // -- Turn 4 (P1): Play sea-5 face-up to sea --
    state = apply(state, { type: "play", cardId: "sea-5", theater: "sea", faceUp: true }, "player-1");

    // -- Turn 5 (P0): Play land-6 face-up to land --
    state = apply(state, { type: "play", cardId: "land-6", theater: "land", faceUp: true }, "player-0");

    // -- Turn 6 (P1): Withdraws with 4 cards remaining --
    // P1 is 2nd player, withdraws with 4 cards → 3 pts to P0.
    expect(state.round!.hands["player-1"]).toHaveLength(4);
    state = apply(state, { type: "withdraw" }, "player-1");

    // P0 reaches 12 points (9 + 3) → GAME OVER!
    expect(state.phase).toBe("game-over");
    expect(state.scores).toEqual({ "player-0": 12, "player-1": 0 });
    expect(state.lastRoundWinner).toBe("player-0");

    // Verify game-over state
    expect(alsGame.getWinner(state)).toEqual(["player-0"]);
    expect(alsGame.activePlayerIds(state)).toEqual([]);

    // Cannot start another round
    const error = alsGame.validateAction(state, { type: "start-next-round" }, "player-0");
    expect(error).toBe("Game is over");
  });
});
