/**
 * Ability tests for Air, Land & Sea.
 *
 * Tests at the reducer level: construct specific board states,
 * apply actions, verify ability effects.
 */
import { describe, it, expect } from "vitest";
import { alsGame } from "../../games/air-land-sea/index.js";
import { makeRound, makeGameState } from "./helpers.js";
import type { ALSState, ALSAction, RoundState } from "../../games/air-land-sea/types.js";
import type { SeededRng } from "../../random.js";

const noopRng: SeededRng = {
  next: () => 0,
  int: () => 0,
  pick: (a) => a[0],
  shuffle: (a) => a,
};

function apply(state: ALSState, action: ALSAction, playerId: string, rng = noopRng): ALSState {
  return alsGame.reducer(state, action, playerId, rng);
}

function validate(state: ALSState, action: ALSAction, playerId: string): string | null {
  return alsGame.validateAction(state, action, playerId);
}

describe("Air, Land & Sea — abilities", () => {
  // ==========================================
  // ONGOING ABILITIES (no resolution needed)
  // ==========================================

  // ==========================================
  // DYNAMIC THEATER ORDER
  // ==========================================

  describe("dynamic theater order", () => {
    it("Maneuver adjacency depends on theater order", () => {
      // Order: Sea - Air - Land (Air is in the middle, adjacent to Sea and Land)
      // Play Maneuver to Air → can flip in Sea or Land (both adjacent)
      const round = makeRound({
        p0Hand: ["air-3"],
        p1Hand: ["sea-6"],
        theaterOrder: ["sea", "air", "land"],
      });
      round.theaters.sea.stacks["player-1"] = [{ cardId: "sea-4", faceUp: true }];
      round.theaters.land.stacks["player-1"] = [{ cardId: "land-6", faceUp: true }];
      const state = makeGameState(round);

      const s = apply(state, { type: "play", cardId: "air-3", theater: "air", faceUp: true }, "player-0");

      // Maneuver in air → adjacent = [sea, land] with this order
      expect(s.round!.pendingAbility!.type).toBe("maneuver");
      if (s.round!.pendingAbility!.type === "maneuver") {
        expect(s.round!.pendingAbility!.adjacentTheaters).toContain("sea");
        expect(s.round!.pendingAbility!.adjacentTheaters).toContain("land");
      }
    });

    it("Support bonus depends on theater order", () => {
      // Order: Land - Air - Sea (Air is adjacent to Land and Sea)
      const round = makeRound({
        p0Hand: ["air-1", "land-6", "sea-6"],
        p1Hand: ["air-6", "land-5", "sea-5"],
        theaterOrder: ["land", "air", "sea"],
      });
      const state = makeGameState(round);

      // Play Support face-up to air
      let s = apply(state, { type: "play", cardId: "air-1", theater: "air", faceUp: true }, "player-0");
      s = apply(s, { type: "play", cardId: "air-6", theater: "air", faceUp: true }, "player-1");
      s = apply(s, { type: "play", cardId: "land-6", theater: "land", faceUp: true }, "player-0");
      s = apply(s, { type: "play", cardId: "sea-5", theater: "sea", faceUp: true }, "player-1");
      s = apply(s, { type: "play", cardId: "sea-6", theater: "sea", faceUp: true }, "player-0");

      const view = alsGame.view(s, "player-0");
      // Air is adjacent to both Land and Sea in this order
      expect(view.theaterStrengths.land["player-0"]).toBe(9); // 6 + 3
      expect(view.theaterStrengths.sea["player-0"]).toBe(9); // 6 + 3
    });

    it("with Air on the edge, Support only applies to one adjacent theater", () => {
      // Order: Air - Sea - Land (Air is on the left edge, adjacent to Sea only)
      const round = makeRound({
        p0Hand: ["air-1", "land-6", "sea-6"],
        p1Hand: ["air-6", "land-5", "sea-5"],
        theaterOrder: ["air", "sea", "land"],
      });
      const state = makeGameState(round);

      let s = apply(state, { type: "play", cardId: "air-1", theater: "air", faceUp: true }, "player-0");
      s = apply(s, { type: "play", cardId: "air-6", theater: "air", faceUp: true }, "player-1");
      s = apply(s, { type: "play", cardId: "land-6", theater: "land", faceUp: true }, "player-0");
      s = apply(s, { type: "play", cardId: "sea-5", theater: "sea", faceUp: true }, "player-1");
      s = apply(s, { type: "play", cardId: "sea-6", theater: "sea", faceUp: true }, "player-0");

      const view = alsGame.view(s, "player-0");
      // Air is adjacent to Sea only (not Land) in this order
      expect(view.theaterStrengths.sea["player-0"]).toBe(9); // 6 + 3
      expect(view.theaterStrengths.land["player-0"]).toBe(6); // no bonus
    });

    it("theaterOrder is included in the view", () => {
      const round = makeRound({
        p0Hand: ["air-6"],
        p1Hand: ["sea-6"],
        theaterOrder: ["sea", "land", "air"],
      });
      const state = makeGameState(round);

      const view = alsGame.view(state, "player-0");
      expect(view.theaterOrder).toEqual(["sea", "land", "air"]);

      const spectator = alsGame.spectatorView(state);
      expect(spectator.theaterOrder).toEqual(["sea", "land", "air"]);
    });
  });

  describe("ongoing abilities stay active while face-up, even when covered", () => {
    it("multiple ongoing abilities in the same theater are all active", () => {
      // Escalation in sea, then another card on top — Escalation should stay active
      const round = makeRound({
        p0Hand: ["sea-2", "sea-6", "air-6"],
        p1Hand: ["air-1", "land-6", "sea-5"],
      });
      const state = makeGameState(round);

      // p0 plays Escalation face-up to sea
      let s = apply(state, { type: "play", cardId: "sea-2", theater: "sea", faceUp: true }, "player-0");
      s = apply(s, { type: "play", cardId: "air-1", theater: "air", faceUp: true }, "player-1");
      // p0 plays sea-6 on top of Escalation — Escalation is now covered
      s = apply(s, { type: "play", cardId: "sea-6", theater: "sea", faceUp: true }, "player-0");
      s = apply(s, { type: "play", cardId: "land-6", theater: "land", faceUp: true }, "player-1");
      // p0 plays air-6 face-down to land — should be str 4 if Escalation is still active
      s = apply(s, { type: "play", cardId: "air-6", theater: "land", faceUp: false }, "player-0");

      const view = alsGame.view(s, "player-0");
      // Escalation is covered but face-up → still active → face-down cards are str 4
      expect(view.theaterStrengths.land["player-0"]).toBe(4);
    });
  });

  describe("Support (air-1) — ongoing +3 to adjacent theaters", () => {
    it("adds +3 to land when face-up and uncovered in air", () => {
      const round = makeRound({
        p0Hand: ["air-1", "land-6"],
        p1Hand: ["sea-6", "sea-5"],
      });
      const state = makeGameState(round);

      // p0 plays Support face-up to air
      let s = apply(state, { type: "play", cardId: "air-1", theater: "air", faceUp: true }, "player-0");
      // p1 plays sea-6 to sea
      s = apply(s, { type: "play", cardId: "sea-6", theater: "sea", faceUp: true }, "player-1");
      // p0 plays land-6 to land (strength 6 + 3 from Support = 9)
      s = apply(s, { type: "play", cardId: "land-6", theater: "land", faceUp: true }, "player-0");

      const view = alsGame.view(s, "player-0");
      expect(view.theaterStrengths.land["player-0"]).toBe(9); // 6 + 3
      expect(view.theaterStrengths.air["player-0"]).toBe(1); // Support's own strength
      // Sea is NOT adjacent to Air, so no bonus there
      expect(view.theaterStrengths.sea["player-0"]).toBe(0);
    });

    it("keeps bonus even when covered (ongoing abilities stay active while face-up)", () => {
      const round = makeRound({
        p0Hand: ["air-1", "air-6", "land-6"],
        p1Hand: ["sea-6", "sea-5", "sea-4"],
      });
      const state = makeGameState(round);

      // p0 plays Support to air, then covers it
      let s = apply(state, { type: "play", cardId: "air-1", theater: "air", faceUp: true }, "player-0");
      s = apply(s, { type: "play", cardId: "sea-6", theater: "sea", faceUp: true }, "player-1");
      s = apply(s, { type: "play", cardId: "air-6", theater: "air", faceUp: false }, "player-0");
      // air-1 is covered but still face-up → Support stays active
      s = apply(s, { type: "play", cardId: "sea-5", theater: "sea", faceUp: true }, "player-1");
      s = apply(s, { type: "play", cardId: "land-6", theater: "land", faceUp: true }, "player-0");

      const view = alsGame.view(s, "player-0");
      expect(view.theaterStrengths.land["player-0"]).toBe(9); // 6 + 3 from Support
    });
  });

  describe("Aerodrome (air-4) — ongoing, play str<=3 face-up anywhere", () => {
    it("allows playing a str-3 card face-up to non-matching theater", () => {
      const round = makeRound({
        p0Hand: ["air-4", "land-3"],
        p1Hand: ["sea-6", "sea-5"],
      });
      const state = makeGameState(round);

      // Play Aerodrome face-up to air
      let s = apply(state, { type: "play", cardId: "air-4", theater: "air", faceUp: true }, "player-0");
      s = apply(s, { type: "play", cardId: "sea-6", theater: "sea", faceUp: true }, "player-1");

      // Now p0 should be able to play land-3 face-up to sea
      const error = validate(s, { type: "play", cardId: "land-3", theater: "sea", faceUp: true }, "player-0");
      expect(error).toBeNull();
    });

    it("does not allow str-4+ cards face-up to non-matching theater", () => {
      const round = makeRound({
        p0Hand: ["air-4", "land-6"],
        p1Hand: ["sea-6", "sea-5"],
      });
      const state = makeGameState(round);

      let s = apply(state, { type: "play", cardId: "air-4", theater: "air", faceUp: true }, "player-0");
      s = apply(s, { type: "play", cardId: "sea-6", theater: "sea", faceUp: true }, "player-1");

      const error = validate(s, { type: "play", cardId: "land-6", theater: "sea", faceUp: true }, "player-0");
      expect(error).toContain("matching theater");
    });
  });

  describe("Containment (air-5) — ongoing, face-down cards are discarded", () => {
    it("discards a card played face-down by either player", () => {
      const round = makeRound({
        p0Hand: ["air-5", "land-6"],
        p1Hand: ["sea-6", "sea-5"],
      });
      const state = makeGameState(round);

      // p0 plays Containment face-up to air
      let s = apply(state, { type: "play", cardId: "air-5", theater: "air", faceUp: true }, "player-0");
      // p1 plays sea-5 face-down → should be discarded
      s = apply(s, { type: "play", cardId: "sea-5", theater: "land", faceUp: false }, "player-1");

      // Card should not be in the theater
      expect(s.round!.theaters.land.stacks["player-1"]).toHaveLength(0);
      // Card should not be in hand either (it was played and discarded)
      expect(s.round!.hands["player-1"]).not.toContain("sea-5");
    });
  });

  describe("Cover Fire (land-4) — ongoing, covered cards become str 4", () => {
    it("sets covered cards to strength 4", () => {
      const round = makeRound({
        p0Hand: ["land-1", "land-4", "air-6"],
        p1Hand: ["sea-6", "sea-5", "sea-4"],
      });
      const state = makeGameState(round);

      // p0 plays land-1 (str 1) face-up to land
      let s = apply(state, { type: "play", cardId: "land-1", theater: "land", faceUp: true }, "player-0");
      s = apply(s, { type: "play", cardId: "sea-6", theater: "sea", faceUp: true }, "player-1");
      // p0 plays Cover Fire on top → land-1 is now covered, becomes str 4
      s = apply(s, { type: "play", cardId: "land-4", theater: "land", faceUp: true }, "player-0");

      const view = alsGame.view(s, "player-0");
      // land: land-1 (covered → str 4) + land-4 (str 4) = 8
      expect(view.theaterStrengths.land["player-0"]).toBe(8);
    });
  });

    it("Cover Fire affects cards below it but not cards above it", () => {
      const round = makeRound({
        p0Hand: ["land-1", "land-4", "land-6"],
        p1Hand: ["sea-6", "sea-5", "sea-4"],
      });
      const state = makeGameState(round);

      // Stack will be: land-1 (bottom), land-4 (Cover Fire, middle), land-6 (top)
      let s = apply(state, { type: "play", cardId: "land-1", theater: "land", faceUp: true }, "player-0");
      s = apply(s, { type: "play", cardId: "sea-6", theater: "sea", faceUp: true }, "player-1");
      s = apply(s, { type: "play", cardId: "land-4", theater: "land", faceUp: true }, "player-0");
      s = apply(s, { type: "play", cardId: "sea-5", theater: "sea", faceUp: true }, "player-1");
      s = apply(s, { type: "play", cardId: "land-6", theater: "land", faceUp: true }, "player-0");

      const view = alsGame.view(s, "player-0");
      // land-1: below Cover Fire → str 4
      // land-4: Cover Fire itself → str 4 (its own printed strength)
      // land-6: above Cover Fire → str 6 (not affected, Cover Fire only affects cards below)
      expect(view.theaterStrengths.land["player-0"]).toBe(4 + 4 + 6);
    });

    it("Cover Fire stays active even when covered (ongoing abilities persist while face-up)", () => {
      const round = makeRound({
        p0Hand: ["land-1", "land-4", "land-6"],
        p1Hand: ["sea-6", "sea-5", "sea-4"],
      });
      const state = makeGameState(round);

      // p0 plays land-1 (str 1) to land
      let s = apply(state, { type: "play", cardId: "land-1", theater: "land", faceUp: true }, "player-0");
      s = apply(s, { type: "play", cardId: "sea-6", theater: "sea", faceUp: true }, "player-1");
      // p0 plays Cover Fire on top of land-1 → land-1 becomes str 4
      s = apply(s, { type: "play", cardId: "land-4", theater: "land", faceUp: true }, "player-0");
      s = apply(s, { type: "play", cardId: "sea-5", theater: "sea", faceUp: true }, "player-1");
      // p0 plays land-6 on top of Cover Fire → Cover Fire is covered but still face-up
      s = apply(s, { type: "play", cardId: "land-6", theater: "land", faceUp: true }, "player-0");

      // Stack: [land-1(str 1, covered by Cover Fire → str 4), land-4(str 4, covered but active), land-6(str 6, top)]
      // Cover Fire is covered but still face-up → its ongoing ability stays active
      // land-1 stays at str 4 (affected by Cover Fire)
      const view = alsGame.view(s, "player-0");
      expect(view.theaterStrengths.land["player-0"]).toBe(4 + 4 + 6); // 14
    });

  describe("Escalation (sea-2) — ongoing, face-down cards become str 4", () => {
    it("makes all player's face-down cards strength 4", () => {
      const round = makeRound({
        p0Hand: ["sea-2", "air-6", "land-6"],
        p1Hand: ["sea-6", "sea-5", "sea-4"],
      });
      const state = makeGameState(round);

      // p0 plays Escalation face-up to sea
      let s = apply(state, { type: "play", cardId: "sea-2", theater: "sea", faceUp: true }, "player-0");
      s = apply(s, { type: "play", cardId: "sea-6", theater: "sea", faceUp: true }, "player-1");
      // p0 plays air-6 face-down to land (normally str 2, with Escalation str 4)
      s = apply(s, { type: "play", cardId: "air-6", theater: "land", faceUp: false }, "player-0");

      const view = alsGame.view(s, "player-0");
      expect(view.theaterStrengths.land["player-0"]).toBe(4);
    });

    it("does not affect opponent's face-down cards", () => {
      const round = makeRound({
        p0Hand: ["sea-2", "air-6"],
        p1Hand: ["sea-6", "land-1"],
      });
      const state = makeGameState(round);

      let s = apply(state, { type: "play", cardId: "sea-2", theater: "sea", faceUp: true }, "player-0");
      // p1 plays land-1 face-down to air (should be str 2, not affected by p0's Escalation)
      s = apply(s, { type: "play", cardId: "land-1", theater: "air", faceUp: false }, "player-1");

      const view = alsGame.view(s, "player-0");
      expect(view.theaterStrengths.air["player-1"]).toBe(2);
    });
  });

  describe("Blockade (sea-5) — ongoing, discard cards played to adjacent theater with 3+ cards", () => {
    it("discards a card played to land when land has 3+ cards", () => {
      // Set up land with 3 cards already
      const round = makeRound({
        p0Hand: ["sea-5", "land-1"],
        p1Hand: ["sea-6", "land-2"],
      });
      // Pre-populate land with 3 face-down cards
      round.theaters.land.stacks["player-0"] = [
        { cardId: "air-1", faceUp: false },
        { cardId: "air-2", faceUp: false },
      ];
      round.theaters.land.stacks["player-1"] = [
        { cardId: "air-3", faceUp: false },
      ];
      const state = makeGameState(round);

      // p0 plays Blockade face-up to sea
      let s = apply(state, { type: "play", cardId: "sea-5", theater: "sea", faceUp: true }, "player-0");
      // p1 tries to play to land (already has 3 cards) → discarded
      s = apply(s, { type: "play", cardId: "land-2", theater: "land", faceUp: true }, "player-1");

      // land-2 should be discarded, not in the theater
      const landP1 = s.round!.theaters.land.stacks["player-1"];
      expect(landP1.some(c => c.cardId === "land-2")).toBe(false);
    });

    it("does not affect theaters not adjacent to sea", () => {
      // Air is not adjacent to Sea, so Blockade shouldn't affect Air
      const round = makeRound({
        p0Hand: ["sea-5", "air-6"],
        p1Hand: ["air-5", "land-6"],
      });
      round.theaters.air.stacks["player-0"] = [
        { cardId: "air-1", faceUp: false },
        { cardId: "air-2", faceUp: false },
      ];
      round.theaters.air.stacks["player-1"] = [
        { cardId: "air-3", faceUp: false },
      ];
      const state = makeGameState(round);

      let s = apply(state, { type: "play", cardId: "sea-5", theater: "sea", faceUp: true }, "player-0");
      // p1 plays to air (3 cards already, but air is not adjacent to sea)
      s = apply(s, { type: "play", cardId: "air-5", theater: "air", faceUp: true }, "player-1");

      const airP1 = s.round!.theaters.air.stacks["player-1"];
      expect(airP1.some(c => c.cardId === "air-5")).toBe(true);
    });
  });

  // ==========================================
  // INSTANT ABILITIES WITH TARGET CHOICE
  // ==========================================

  describe("Maneuver (air-3, land-3, sea-3) — flip a card in adjacent theater", () => {
    it("creates pending ability when played face-up", () => {
      const round = makeRound({
        p0Hand: ["land-3", "air-6"],
        p1Hand: ["sea-6", "air-5"],
      });
      // Put a card in air for p1 to have something to flip
      round.theaters.air.stacks["player-1"] = [{ cardId: "air-4", faceUp: true }];
      const state = makeGameState(round);

      // p0 plays Maneuver to land → should create pending ability to flip in air or sea
      const s = apply(state, { type: "play", cardId: "land-3", theater: "land", faceUp: true }, "player-0");

      expect(s.round!.pendingAbility).not.toBeNull();
      expect(s.round!.pendingAbility!.type).toBe("maneuver");
    });

    it("flips a target card when resolved", () => {
      const round = makeRound({
        p0Hand: ["land-3"],
        p1Hand: ["sea-6"],
      });
      round.theaters.air.stacks["player-1"] = [{ cardId: "air-4", faceUp: true }];
      const state = makeGameState(round);

      // Play maneuver
      let s = apply(state, { type: "play", cardId: "land-3", theater: "land", faceUp: true }, "player-0");
      // Resolve: flip p1's air-4 face-down
      s = apply(s, { type: "choose-flip", theater: "air", cardOwner: "player-1", cardIndex: 0 }, "player-0");

      expect(s.round!.theaters.air.stacks["player-1"][0].faceUp).toBe(false);
      expect(s.round!.pendingAbility).toBeNull();
    });

    it("rejects flipping in non-adjacent theater", () => {
      const round = makeRound({
        p0Hand: ["air-3"],
        p1Hand: ["sea-6"],
      });
      // air-3 played to air → adjacent to land only (not sea)
      round.theaters.sea.stacks["player-1"] = [{ cardId: "sea-4", faceUp: true }];
      const state = makeGameState(round);

      let s = apply(state, { type: "play", cardId: "air-3", theater: "air", faceUp: true }, "player-0");

      const error = validate(s, { type: "choose-flip", theater: "sea", cardOwner: "player-1", cardIndex: 0 }, "player-0");
      expect(error).not.toBeNull();
    });
  });

  describe("Ambush (land-2) — flip a card in any theater", () => {
    it("allows flipping in any theater, not just adjacent", () => {
      const round = makeRound({
        p0Hand: ["land-2"],
        p1Hand: ["sea-6"],
      });
      round.theaters.sea.stacks["player-1"] = [{ cardId: "sea-4", faceUp: true }];
      const state = makeGameState(round);

      let s = apply(state, { type: "play", cardId: "land-2", theater: "land", faceUp: true }, "player-0");

      expect(s.round!.pendingAbility).not.toBeNull();
      expect(s.round!.pendingAbility!.type).toBe("ambush");

      // Should allow flipping in sea (not adjacent to land)
      const error = validate(s, { type: "choose-flip", theater: "sea", cardOwner: "player-1", cardIndex: 0 }, "player-0");
      expect(error).toBeNull();
    });
  });

  describe("Air Drop (air-2) — next turn play face-up to any theater", () => {
    it("allows playing next card face-up to non-matching theater", () => {
      const round = makeRound({
        p0Hand: ["air-2", "land-6"],
        p1Hand: ["sea-6", "sea-5"],
      });
      const state = makeGameState(round);

      // Play Air Drop face-up to air
      let s = apply(state, { type: "play", cardId: "air-2", theater: "air", faceUp: true }, "player-0");
      s = apply(s, { type: "play", cardId: "sea-6", theater: "sea", faceUp: true }, "player-1");

      // p0's next turn: should be able to play land-6 face-up to sea
      const error = validate(s, { type: "play", cardId: "land-6", theater: "sea", faceUp: true }, "player-0");
      expect(error).toBeNull();
    });

    it("effect expires after one turn", () => {
      const round = makeRound({
        p0Hand: ["air-2", "land-6", "sea-1"],
        p1Hand: ["sea-6", "sea-5", "sea-4"],
      });
      const state = makeGameState(round);

      // Play Air Drop
      let s = apply(state, { type: "play", cardId: "air-2", theater: "air", faceUp: true }, "player-0");
      s = apply(s, { type: "play", cardId: "sea-6", theater: "sea", faceUp: true }, "player-1");
      // Use the Air Drop benefit
      s = apply(s, { type: "play", cardId: "land-6", theater: "sea", faceUp: true }, "player-0");
      s = apply(s, { type: "play", cardId: "sea-5", theater: "sea", faceUp: true }, "player-1");

      // Air Drop should be consumed — can't do it again
      const error = validate(s, { type: "play", cardId: "sea-1", theater: "air", faceUp: true }, "player-0");
      expect(error).toContain("matching theater");
    });
  });

  describe("Transport (sea-1) — move one of your cards to a different theater", () => {
    it("creates pending ability when played", () => {
      const round = makeRound({
        p0Hand: ["sea-1"],
        p1Hand: ["sea-6"],
      });
      round.theaters.air.stacks["player-0"] = [{ cardId: "air-6", faceUp: true }];
      const state = makeGameState(round);

      const s = apply(state, { type: "play", cardId: "sea-1", theater: "sea", faceUp: true }, "player-0");
      expect(s.round!.pendingAbility).not.toBeNull();
      expect(s.round!.pendingAbility!.type).toBe("transport");
    });

    it("moves a card to a different theater", () => {
      const round = makeRound({
        p0Hand: ["sea-1"],
        p1Hand: ["sea-6"],
      });
      round.theaters.air.stacks["player-0"] = [{ cardId: "air-6", faceUp: true }];
      const state = makeGameState(round);

      let s = apply(state, { type: "play", cardId: "sea-1", theater: "sea", faceUp: true }, "player-0");
      s = apply(s, { type: "choose-transport", fromTheater: "air", cardIndex: 0, toTheater: "land" }, "player-0");

      expect(s.round!.theaters.air.stacks["player-0"]).toHaveLength(0);
      expect(s.round!.theaters.land.stacks["player-0"]).toHaveLength(1);
      expect(s.round!.theaters.land.stacks["player-0"][0].cardId).toBe("air-6");
    });
  });

  describe("Reinforce (land-1) — peek at deck top, optionally play face-down to adjacent theater", () => {
    it("creates pending ability with the top card revealed to player", () => {
      const round = makeRound({
        p0Hand: ["land-1"],
        p1Hand: ["sea-6"],
        deck: ["air-5", "sea-3"],
      });
      const state = makeGameState(round);

      const s = apply(state, { type: "play", cardId: "land-1", theater: "land", faceUp: true }, "player-0");
      expect(s.round!.pendingAbility).not.toBeNull();
      expect(s.round!.pendingAbility!.type).toBe("reinforce");
      if (s.round!.pendingAbility!.type === "reinforce") {
        expect(s.round!.pendingAbility!.topCard).toBe("air-5");
      }
    });

    it("plays the top card face-down to an adjacent theater", () => {
      const round = makeRound({
        p0Hand: ["land-1"],
        p1Hand: ["sea-6"],
        deck: ["air-5", "sea-3"],
      });
      const state = makeGameState(round);

      let s = apply(state, { type: "play", cardId: "land-1", theater: "land", faceUp: true }, "player-0");
      s = apply(s, { type: "choose-reinforce", play: true, theater: "air" }, "player-0");

      expect(s.round!.theaters.air.stacks["player-0"]).toHaveLength(1);
      expect(s.round!.theaters.air.stacks["player-0"][0]).toEqual({
        cardId: "air-5",
        faceUp: false,
      });
      expect(s.round!.deck).toEqual(["sea-3"]);
    });

    it("can decline to play the card", () => {
      const round = makeRound({
        p0Hand: ["land-1"],
        p1Hand: ["sea-6"],
        deck: ["air-5", "sea-3"],
      });
      const state = makeGameState(round);

      let s = apply(state, { type: "play", cardId: "land-1", theater: "land", faceUp: true }, "player-0");
      s = apply(s, { type: "choose-reinforce", play: false }, "player-0");

      // Card stays on top of deck
      expect(s.round!.deck[0]).toBe("air-5");
      expect(s.round!.pendingAbility).toBeNull();
    });

    it("card is discarded by Containment when played face-down via Reinforce", () => {
      const round = makeRound({
        p0Hand: ["land-1"],
        p1Hand: ["sea-6"],
        deck: ["sea-3", "air-6"],
      });
      // P1 has Containment active in air
      round.theaters.air.stacks["player-1"] = [{ cardId: "air-5", faceUp: true }];
      const state = makeGameState(round);

      // P0 plays Reinforce
      let s = apply(state, { type: "play", cardId: "land-1", theater: "land", faceUp: true }, "player-0");
      // P0 chooses to play the top card (sea-3) face-down to air
      s = apply(s, { type: "choose-reinforce", play: true, theater: "air" }, "player-0");

      // Containment should have discarded the card — it should NOT be in the theater
      expect(s.round!.theaters.air.stacks["player-0"]).toHaveLength(0);
      // Card should be at the bottom of the deck (discarded)
      expect(s.round!.deck[s.round!.deck.length - 1]).toBe("sea-3");
    });
  });

  describe("Redeploy (sea-4) — return face-down card to hand, gain extra turn", () => {
    it("picks up a face-down card and grants extra turn", () => {
      const round = makeRound({
        p0Hand: ["sea-4", "air-6"],
        p1Hand: ["sea-6", "sea-5"],
      });
      round.theaters.land.stacks["player-0"] = [{ cardId: "land-1", faceUp: false }];
      const state = makeGameState(round);

      let s = apply(state, { type: "play", cardId: "sea-4", theater: "sea", faceUp: true }, "player-0");
      s = apply(s, { type: "choose-redeploy", theater: "land", cardIndex: 0 }, "player-0");

      // Card should be back in hand
      expect(s.round!.hands["player-0"]).toContain("land-1");
      expect(s.round!.theaters.land.stacks["player-0"]).toHaveLength(0);
      // Extra turn: still p0's turn
      expect(s.round!.currentPlayer).toBe("player-0");
    });

    it("rejects picking up a face-up card", () => {
      const round = makeRound({
        p0Hand: ["sea-4"],
        p1Hand: ["sea-6"],
      });
      round.theaters.land.stacks["player-0"] = [{ cardId: "land-1", faceUp: true }];
      const state = makeGameState(round);

      let s = apply(state, { type: "play", cardId: "sea-4", theater: "sea", faceUp: true }, "player-0");

      const error = validate(s, { type: "choose-redeploy", theater: "land", cardIndex: 0 }, "player-0");
      expect(error).not.toBeNull();
    });
  });

  describe("Disrupt (land-5) — opponent flips theirs, then you flip yours", () => {
    it("goes through two-step resolution", () => {
      const round = makeRound({
        p0Hand: ["land-5"],
        p1Hand: ["sea-6"],
      });
      round.theaters.air.stacks["player-0"] = [{ cardId: "air-1", faceUp: false }];
      round.theaters.sea.stacks["player-1"] = [{ cardId: "sea-4", faceUp: true }];
      const state = makeGameState(round);

      // Play Disrupt
      let s = apply(state, { type: "play", cardId: "land-5", theater: "land", faceUp: true }, "player-0");

      // Step 1: opponent (p1) must flip one of their own cards
      expect(s.round!.pendingAbility!.type).toBe("disrupt-opponent");
      expect(s.round!.pendingAbility!.playerId).toBe("player-1");

      s = apply(s, { type: "choose-disrupt-flip", theater: "sea", cardIndex: 0 }, "player-1");

      // p1's sea-4 should now be face-down
      expect(s.round!.theaters.sea.stacks["player-1"][0].faceUp).toBe(false);

      // Step 2: p0 must flip one of their own cards
      expect(s.round!.pendingAbility!.type).toBe("disrupt-self");
      expect(s.round!.pendingAbility!.playerId).toBe("player-0");

      s = apply(s, { type: "choose-disrupt-flip", theater: "air", cardIndex: 0 }, "player-0");

      // p0's air-1 should now be face-up
      expect(s.round!.theaters.air.stacks["player-0"][0].faceUp).toBe(true);
      expect(s.round!.pendingAbility).toBeNull();
    });
  });

  // ==========================================
  // FLIPPING FACE-DOWN CARDS TRIGGERS ABILITIES
  // ==========================================

  describe("flipping a face-down card face-up triggers its ability", () => {
    it("flipping a face-down instant card triggers its instant ability", () => {
      // P1 played air-3 (Maneuver) face-down to land earlier.
      // P0 uses Ambush to flip it face-up → Maneuver's instant ability should trigger.
      const round = makeRound({
        p0Hand: ["land-2"],
        p1Hand: ["sea-6"],
      });
      // P1 has air-3 (Maneuver) face-down in land
      round.theaters.land.stacks["player-1"] = [{ cardId: "air-3", faceUp: false }];
      // Put a card in air so the triggered Maneuver has something to flip
      round.theaters.air.stacks["player-0"] = [{ cardId: "air-6", faceUp: true }];
      const state = makeGameState(round);

      // P0 plays Ambush → flip P1's face-down air-3 face-up
      let s = apply(state, { type: "play", cardId: "land-2", theater: "land", faceUp: true }, "player-0");
      s = apply(s, { type: "choose-flip", theater: "land", cardOwner: "player-1", cardIndex: 0 }, "player-0");

      // air-3 is now face-up → its Maneuver instant ability should trigger
      expect(s.round!.theaters.land.stacks["player-1"][0].faceUp).toBe(true);
      // A new pending ability should exist for the Maneuver that was just revealed
      expect(s.round!.pendingAbility).not.toBeNull();
      expect(s.round!.pendingAbility!.type).toBe("maneuver");
      // The Maneuver belongs to P1 (their card), so P1 resolves it
      expect(s.round!.pendingAbility!.playerId).toBe("player-1");
    });

    it("flipping a face-down ongoing card activates its ongoing ability", () => {
      // P0 played sea-2 (Escalation) face-down. Opponent flips it face-up.
      // Escalation should now be active (P0's face-down cards become str 4).
      const round = makeRound({
        p0Hand: ["land-6"],
        p1Hand: ["land-2"],
      });
      round.theaters.sea.stacks["player-0"] = [{ cardId: "sea-2", faceUp: false }];
      // P0 also has a face-down card in air to test Escalation's effect
      round.theaters.air.stacks["player-0"] = [{ cardId: "air-6", faceUp: false }];
      const state = makeGameState(round, { firstPlayer: "player-1" });

      // P1 plays Ambush → flip P0's sea-2 face-up
      let s = apply(state, { type: "play", cardId: "land-2", theater: "land", faceUp: true }, "player-1");
      s = apply(s, { type: "choose-flip", theater: "sea", cardOwner: "player-0", cardIndex: 0 }, "player-1");

      // sea-2 (Escalation) is now face-up → P0's face-down cards should be str 4
      const view = alsGame.view(s, "player-0");
      expect(view.theaterStrengths.air["player-0"]).toBe(4); // face-down air-6 = str 4 (Escalation)
    });
  });

  // ==========================================
  // COVERED CARDS CANNOT BE FLIPPED
  // ==========================================

  describe("covered cards cannot be flipped", () => {
    it("Maneuver rejects flipping a covered card", () => {
      const round = makeRound({
        p0Hand: ["land-3"],
        p1Hand: ["sea-6"],
      });
      // P1 has two cards in air — bottom one is covered
      round.theaters.air.stacks["player-1"] = [
        { cardId: "air-1", faceUp: true },  // index 0, covered
        { cardId: "air-6", faceUp: true },  // index 1, top (uncovered)
      ];
      const state = makeGameState(round);

      // P0 plays Maneuver to land → can flip in adjacent (air or sea)
      let s = apply(state, { type: "play", cardId: "land-3", theater: "land", faceUp: true }, "player-0");

      // Flipping the top card (uncovered) should work
      const topError = validate(s, { type: "choose-flip", theater: "air", cardOwner: "player-1", cardIndex: 1 }, "player-0");
      expect(topError).toBeNull();

      // Flipping the covered card (index 0) should be rejected
      const coveredError = validate(s, { type: "choose-flip", theater: "air", cardOwner: "player-1", cardIndex: 0 }, "player-0");
      expect(coveredError).not.toBeNull();
    });

    it("Ambush rejects flipping a covered card", () => {
      const round = makeRound({
        p0Hand: ["land-2"],
        p1Hand: ["sea-6"],
      });
      round.theaters.sea.stacks["player-1"] = [
        { cardId: "sea-1", faceUp: true },  // covered
        { cardId: "sea-6", faceUp: true },  // top
      ];
      const state = makeGameState(round);

      let s = apply(state, { type: "play", cardId: "land-2", theater: "land", faceUp: true }, "player-0");

      const coveredError = validate(s, { type: "choose-flip", theater: "sea", cardOwner: "player-1", cardIndex: 0 }, "player-0");
      expect(coveredError).not.toBeNull();
    });

    it("Disrupt rejects flipping a covered card", () => {
      const round = makeRound({
        p0Hand: ["land-5"],
        p1Hand: ["sea-6"],
      });
      round.theaters.sea.stacks["player-1"] = [
        { cardId: "sea-1", faceUp: true },  // covered
        { cardId: "sea-4", faceUp: true },  // top
      ];
      round.theaters.air.stacks["player-0"] = [
        { cardId: "air-1", faceUp: false },
      ];
      const state = makeGameState(round);

      // P0 plays Disrupt → P1 must flip one of their own
      let s = apply(state, { type: "play", cardId: "land-5", theater: "land", faceUp: true }, "player-0");

      // P1 trying to flip their covered card should be rejected
      const coveredError = validate(s, { type: "choose-disrupt-flip", theater: "sea", cardIndex: 0 }, "player-1");
      expect(coveredError).not.toBeNull();

      // P1 flipping their top card should work
      const topError = validate(s, { type: "choose-disrupt-flip", theater: "sea", cardIndex: 1 }, "player-1");
      expect(topError).toBeNull();
    });
  });

  // ==========================================
  // ABILITIES WITH NO VALID TARGETS
  // ==========================================

  describe("abilities with no valid targets should not freeze the game", () => {
    it("Maneuver auto-skips when adjacent theaters are empty", () => {
      // Play Maneuver to land as the very first card — air and sea are empty
      const round = makeRound({
        p0Hand: ["land-3"],
        p1Hand: ["sea-6"],
      });
      const state = makeGameState(round);

      const s = apply(state, { type: "play", cardId: "land-3", theater: "land", faceUp: true }, "player-0");

      // Should NOT have a pending ability — nothing to flip
      expect(s.round!.pendingAbility).toBeNull();
      // Turn should advance normally
      expect(s.round!.currentPlayer).toBe("player-1");
    });

    it("Redeploy auto-skips when player has no face-down cards", () => {
      const round = makeRound({
        p0Hand: ["sea-4"],
        p1Hand: ["sea-6"],
      });
      // P0 has only face-up cards on the board
      round.theaters.air.stacks["player-0"] = [{ cardId: "air-6", faceUp: true }];
      const state = makeGameState(round);

      const s = apply(state, { type: "play", cardId: "sea-4", theater: "sea", faceUp: true }, "player-0");

      // Should NOT have a pending ability — no face-down cards to pick up
      expect(s.round!.pendingAbility).toBeNull();
      expect(s.round!.currentPlayer).toBe("player-1");
    });

    it("Disrupt auto-skips when opponent has no cards on the board", () => {
      // Play Disrupt as the first card — opponent has nothing to flip
      const round = makeRound({
        p0Hand: ["land-5"],
        p1Hand: ["sea-6"],
      });
      const state = makeGameState(round);

      const s = apply(state, { type: "play", cardId: "land-5", theater: "land", faceUp: true }, "player-0");

      // Should NOT have a pending ability — opponent has no cards
      expect(s.round!.pendingAbility).toBeNull();
      expect(s.round!.currentPlayer).toBe("player-1");
    });

    it("Transport auto-skips when player has no other cards in play", () => {
      // Play Transport with no other cards on the board
      const round = makeRound({
        p0Hand: ["sea-1"],
        p1Hand: ["sea-6"],
      });
      const state = makeGameState(round);

      const s = apply(state, { type: "play", cardId: "sea-1", theater: "sea", faceUp: true }, "player-0");

      // Transport was just played — it's the only card. Nothing else to move.
      expect(s.round!.pendingAbility).toBeNull();
      expect(s.round!.currentPlayer).toBe("player-1");
    });

    it("Reinforce auto-skips when deck is empty", () => {
      const round = makeRound({
        p0Hand: ["land-1"],
        p1Hand: ["sea-6"],
        deck: [], // empty deck
      });
      const state = makeGameState(round);

      const s = apply(state, { type: "play", cardId: "land-1", theater: "land", faceUp: true }, "player-0");

      // Can't peek at anything — no deck
      expect(s.round!.pendingAbility).toBeNull();
      expect(s.round!.currentPlayer).toBe("player-1");
    });

    it("Ambush auto-skips when no cards exist on the board to flip", () => {
      // Play Ambush as the very first card — only the Ambush itself is on the board
      const round = makeRound({
        p0Hand: ["land-2"],
        p1Hand: ["sea-6"],
      });
      const state = makeGameState(round);

      const s = apply(state, { type: "play", cardId: "land-2", theater: "land", faceUp: true }, "player-0");

      // The only card on the board is the Ambush itself — flipping it would be weird
      // but technically there IS a valid target (your own card).
      // Ambush can flip ANY card, including your own. So this should still create a pending.
      // But if we decide flipping your own just-played card is valid, keep the pending.
      // Let's verify the game doesn't freeze either way.
      if (s.round!.pendingAbility) {
        // If pending exists, flipping own card should work
        const s2 = apply(s, { type: "choose-flip", theater: "land", cardOwner: "player-0", cardIndex: 0 }, "player-0");
        expect(s2.round!.pendingAbility).toBeNull();
      } else {
        expect(s.round!.currentPlayer).toBe("player-1");
      }
    });
  });
});
