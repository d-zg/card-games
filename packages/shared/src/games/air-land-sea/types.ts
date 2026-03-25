import type { PlayerId } from "../../types.js";

export type Theater = "air" | "land" | "sea";

export type AbilityType = "instant" | "ongoing" | "none";

export interface CardDef {
  id: string; // e.g. "air-1", "land-4"
  theater: Theater;
  strength: number;
  name: string;
  abilityType: AbilityType;
  abilityText: string;
}

/** A card in play on the board. */
export interface PlayedCard {
  cardId: string;
  faceUp: boolean;
}

/** Per-player stack of cards in a theater (last element = top/uncovered). */
export type TheaterStack = PlayedCard[];

export interface TheaterState {
  stacks: Record<PlayerId, TheaterStack>;
}

/** An entry in the action log. Contains both a public and private description. */
export interface LogEntry {
  playerId: PlayerId;
  /** Full description (visible to the acting player — includes face-down card identity). */
  text: string;
  /** Description for opponent/spectators (face-down card identities hidden). */
  publicText: string;
}

export interface RoundState {
  /** Theater display order (left to right). Determines adjacency. */
  theaterOrder: Theater[];
  theaters: Record<Theater, TheaterState>;
  hands: Record<PlayerId, string[]>; // card IDs
  deck: string[]; // card IDs, index 0 = top
  currentPlayer: PlayerId;
  /** Tracks who played the very last card (for tie-breaking). */
  lastPlayerToPlay: PlayerId | null;
  /** Air Drop: if set, this player may play one card face-up to a non-matching theater next turn. */
  airDropNextTurn: PlayerId | null;
  /** Pending ability that needs resolution before the turn continues. */
  pendingAbility: PendingAbility | null;
  /** Action log for the current round. */
  log: LogEntry[];
}

export type PendingAbility =
  | { type: "maneuver"; playerId: PlayerId; adjacentTheaters: Theater[] }
  | { type: "ambush"; playerId: PlayerId }
  | { type: "transport"; playerId: PlayerId }
  | {
      type: "reinforce";
      playerId: PlayerId;
      topCard: string; // card ID peeked from deck
      adjacentTheaters: Theater[];
    }
  | { type: "redeploy"; playerId: PlayerId }
  | { type: "disrupt-opponent"; playerId: PlayerId } // opponent must flip their own card
  | { type: "disrupt-self"; playerId: PlayerId }; // then you flip your own card

export interface ALSState {
  scores: Record<PlayerId, number>;
  round: RoundState | null;
  phase: "playing" | "round-over" | "game-over";
  firstPlayer: PlayerId;
  roundNumber: number;
  /** Who won the last round (loser goes first next round). */
  lastRoundWinner: PlayerId | null;
}

// -- Actions --

export type ALSAction =
  | { type: "play"; cardId: string; theater: Theater; faceUp: boolean }
  | { type: "withdraw" }
  | { type: "start-next-round" }
  // Ability resolution actions:
  | {
      type: "choose-flip";
      theater: Theater;
      cardOwner: PlayerId;
      cardIndex: number;
    }
  | {
      type: "choose-transport";
      fromTheater: Theater;
      cardIndex: number;
      toTheater: Theater;
    }
  | { type: "choose-reinforce"; play: boolean; theater?: Theater }
  | { type: "choose-redeploy"; theater: Theater; cardIndex: number }
  | {
      type: "choose-disrupt-flip";
      theater: Theater;
      cardIndex: number;
    };

// -- View (what a player or spectator sees) --

export interface PlayedCardView {
  cardId: string | null; // null if face-down and belongs to opponent
  faceUp: boolean;
}

export interface TheaterView {
  stacks: Record<PlayerId, PlayedCardView[]>;
}

export interface ALSView {
  myPlayerId: PlayerId | null; // null for spectators
  myHand: string[]; // card IDs (empty for spectators)
  theaters: Record<Theater, TheaterView>;
  currentPlayer: PlayerId;
  scores: Record<PlayerId, number>;
  phase: "playing" | "round-over" | "game-over";
  roundNumber: number;
  opponentHandSize: number;
  /** Whether it's your turn to resolve an ability. */
  pendingAbility: PendingAbilityView | null;
  /** Theater strength totals for display. */
  theaterStrengths: Record<Theater, Record<PlayerId, number>>;
  lastRoundWinner: PlayerId | null;
  /** Whether Air Drop is active for this player (can play next card face-up to any theater). */
  airDropActive: boolean;
  /** Whether Aerodrome is active for this player (str ≤ 3 cards can go face-up to any theater). */
  aerodromeActive: boolean;
  /** Action log for the current round, filtered for this viewer. */
  log: string[];
  /** Theater display order (left to right). Determines adjacency. */
  theaterOrder: Theater[];
  /** Whether this player is the first player this round (affects withdrawal scoring). */
  isFirstPlayer: boolean;
}

export type PendingAbilityView =
  | { type: "maneuver"; playerId: PlayerId; adjacentTheaters: Theater[] }
  | { type: "ambush"; playerId: PlayerId }
  | { type: "transport"; playerId: PlayerId }
  | { type: "reinforce"; playerId: PlayerId; topCard: string | null; adjacentTheaters: Theater[] }
  | { type: "redeploy"; playerId: PlayerId }
  | { type: "disrupt-opponent"; playerId: PlayerId }
  | { type: "disrupt-self"; playerId: PlayerId };
