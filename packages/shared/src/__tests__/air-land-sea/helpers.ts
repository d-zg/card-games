import type { ALSState, RoundState, Theater, TheaterState } from "../../games/air-land-sea/types.js";
import type { PlayerId } from "../../types.js";

/**
 * Build a round state with specific hands for testing.
 * Theaters start empty; deck gets remaining cards.
 */
export function makeRound(opts: {
  p0Hand: string[];
  p1Hand: string[];
  deck?: string[];
  currentPlayer?: PlayerId;
  theaterOrder?: Theater[];
}): RoundState {
  return {
    theaterOrder: opts.theaterOrder ?? ["air", "land", "sea"],
    theaters: {
      air: emptyTheater(),
      land: emptyTheater(),
      sea: emptyTheater(),
    },
    hands: {
      "player-0": [...opts.p0Hand],
      "player-1": [...opts.p1Hand],
    },
    deck: opts.deck ?? [],
    currentPlayer: opts.currentPlayer ?? "player-0",
    lastPlayerToPlay: null,
    airDropNextTurn: null,
    pendingAbility: null,
    queuedAbility: null,
    log: [],
  };
}

export function emptyTheater(): TheaterState {
  return {
    stacks: {
      "player-0": [],
      "player-1": [],
    },
  };
}

/** Create a full game state with a specific round. */
export function makeGameState(
  round: RoundState,
  opts?: {
    scores?: Record<PlayerId, number>;
    firstPlayer?: PlayerId;
    roundNumber?: number;
  },
): ALSState {
  return {
    scores: opts?.scores ?? { "player-0": 0, "player-1": 0 },
    round,
    phase: "playing",
    firstPlayer: opts?.firstPlayer ?? "player-0",
    roundNumber: opts?.roundNumber ?? 1,
    lastRoundWinner: null,
    lastRoundLog: [],
  };
}
