/**
 * A minimal "War" card game for testing the engine.
 *
 * Rules:
 * - 2 players, each dealt a hand of numbers from a shuffled deck
 * - Players take turns playing a card (alternating, player-0 first)
 * - After both play, whoever played the higher card wins the round
 * - First to win 3 rounds wins the game
 *
 * This exercises: hidden info, sequential turns, RNG (shuffle),
 * validation, view filtering, and win detection.
 */
import type { GameDefinition } from "../engine.js";
import type { PlayerId } from "../types.js";
import type { SeededRng } from "../random.js";

export interface WarState {
  hands: Record<PlayerId, number[]>;
  currentPlay: number | null; // card played by first player this round
  currentPlayer: PlayerId;
  wins: Record<PlayerId, number>;
  phase: "playing" | "finished";
  lastRound: { card0: number; card1: number; winner: PlayerId } | null;
}

export type WarAction = { type: "play-card"; card: number };

export interface WarView {
  myHand: number[] | null; // null for spectators
  opponentHandSize: number;
  currentPlay: "waiting" | null; // "waiting" means opponent has played face-down
  currentPlayer: PlayerId;
  wins: Record<PlayerId, number>;
  phase: "playing" | "finished";
  lastRound: { card0: number; card1: number; winner: PlayerId } | null;
}

function makePlayerIds(count: number): PlayerId[] {
  return Array.from({ length: count }, (_, i) => `player-${i}`);
}

export const warGame: GameDefinition<WarState, WarAction, WarView> = {
  meta: {
    id: "war",
    name: "War",
    minPlayers: 2,
    maxPlayers: 2,
  },

  setup(playerCount: number, rng: SeededRng): WarState {
    const players = makePlayerIds(playerCount);
    // Deck: numbers 1-10, shuffled, 5 to each player
    const deck = rng.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    return {
      hands: {
        [players[0]]: deck.slice(0, 5).sort((a, b) => a - b),
        [players[1]]: deck.slice(5, 10).sort((a, b) => a - b),
      },
      currentPlay: null,
      currentPlayer: players[0],
      wins: { [players[0]]: 0, [players[1]]: 0 },
      phase: "playing",
      lastRound: null,
    };
  },

  reducer(
    state: WarState,
    action: WarAction,
    playerId: PlayerId,
    _rng: SeededRng,
  ): WarState {
    const newState = structuredClone(state);
    const hand = newState.hands[playerId];
    const cardIndex = hand.indexOf(action.card);
    hand.splice(cardIndex, 1);

    if (newState.currentPlay === null) {
      // First player this round
      newState.currentPlay = action.card;
      newState.currentPlayer =
        playerId === "player-0" ? "player-1" : "player-0";
    } else {
      // Second player — resolve round
      const card0 =
        playerId === "player-0" ? action.card : newState.currentPlay;
      const card1 =
        playerId === "player-1" ? action.card : newState.currentPlay;
      const winner = card0 >= card1 ? "player-0" : "player-1";
      newState.wins[winner]++;
      newState.lastRound = { card0, card1, winner };
      newState.currentPlay = null;
      newState.currentPlayer = "player-0";

      if (newState.wins[winner] >= 3) {
        newState.phase = "finished";
      }
    }

    return newState;
  },

  view(state: WarState, playerId: PlayerId): WarView {
    const opponent = playerId === "player-0" ? "player-1" : "player-0";
    return {
      myHand: state.hands[playerId] ?? null,
      opponentHandSize: (state.hands[opponent] ?? []).length,
      currentPlay: state.currentPlay !== null && state.currentPlayer === playerId
        ? "waiting"
        : null,
      currentPlayer: state.currentPlayer,
      wins: { ...state.wins },
      phase: state.phase,
      lastRound: state.lastRound,
    };
  },

  spectatorView(state: WarState): WarView {
    return {
      myHand: null,
      opponentHandSize: 0,
      currentPlay: state.currentPlay !== null ? "waiting" : null,
      currentPlayer: state.currentPlayer,
      wins: { ...state.wins },
      phase: state.phase,
      lastRound: state.lastRound,
    };
  },

  validateAction(
    state: WarState,
    action: WarAction,
    playerId: PlayerId,
  ): string | null {
    if (state.phase === "finished") return "Game is over";
    if (playerId !== state.currentPlayer) return "Not your turn";
    if (action.type !== "play-card") return "Invalid action type";
    if (!state.hands[playerId]?.includes(action.card)) {
      return "You don't have that card";
    }
    return null;
  },

  getWinner(state: WarState): PlayerId[] | null {
    if (state.phase !== "finished") return null;
    const p0 = state.wins["player-0"] ?? 0;
    const p1 = state.wins["player-1"] ?? 0;
    if (p0 >= 3) return ["player-0"];
    if (p1 >= 3) return ["player-1"];
    return null;
  },

  activePlayerIds(state: WarState): PlayerId[] {
    if (state.phase === "finished") return [];
    return [state.currentPlayer];
  },
};
