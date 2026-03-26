import type { PlayerId } from "../../types.js";
import type { RoundState, Theater } from "./types.js";
import { getCard, adjacentTheaters } from "./cards.js";

const THEATERS: Theater[] = ["air", "land", "sea"];
const PLAYERS: PlayerId[] = ["player-0", "player-1"];

// ============================================================
// Ongoing ability checks — single source of truth.
// An ongoing ability is active when its card is face-up,
// regardless of whether it is covered.
// ============================================================

/** Is a card face-up anywhere in a stack? Ongoing abilities stay active while face-up, even when covered. */
function isFaceUpInStack(
  stack: { cardId: string; faceUp: boolean }[],
  cardId: string,
): boolean {
  return stack.some((card) => card.cardId === cardId && card.faceUp);
}

/** Find which theater a face-up card is in for a specific player. Returns null if not face-up anywhere. */
function findCardTheater(
  round: RoundState,
  cardId: string,
  playerId: PlayerId,
): Theater | null {
  for (const theater of THEATERS) {
    if (isFaceUpInStack(round.theaters[theater].stacks[playerId], cardId)) {
      return theater;
    }
  }
  return null;
}

/** Is an ongoing ability active for a specific player (in any theater)? */
export function isOngoingActiveForPlayer(
  round: RoundState,
  cardId: string,
  playerId: PlayerId,
): boolean {
  for (const theater of THEATERS) {
    if (isFaceUpInStack(round.theaters[theater].stacks[playerId], cardId)) {
      return true;
    }
  }
  return false;
}

/** Is an ongoing ability active for either player? For global effects like Containment/Blockade. */
export function isOngoingActiveForAny(
  round: RoundState,
  cardId: string,
): boolean {
  return PLAYERS.some((p) => isOngoingActiveForPlayer(round, cardId, p));
}

// ============================================================
// Theater strength calculation
// ============================================================

/**
 * Calculate effective strength for a player in a theater,
 * accounting for face-up/face-down, Cover Fire, Escalation, and Support.
 */
export function theaterStrength(
  round: RoundState,
  theater: Theater,
  playerId: PlayerId,
): number {
  const stack = round.theaters[theater].stacks[playerId];
  let total = 0;

  const hasEscalation = isOngoingActiveForPlayer(round, "sea-2", playerId);

  // Cover Fire: if face-up in this theater, cards below it become str 4.
  // It stays active even when covered (ongoing abilities persist while face-up).
  let coverFireIndex = -1;
  for (let i = 0; i < stack.length; i++) {
    if (stack[i].cardId === "land-4" && stack[i].faceUp) {
      coverFireIndex = i;
      break;
    }
  }

  for (let i = 0; i < stack.length; i++) {
    const played = stack[i];
    const card = getCard(played.cardId);

    if (coverFireIndex !== -1 && i < coverFireIndex) {
      // Covered by Cover Fire → strength 4
      total += 4;
    } else if (played.faceUp) {
      total += card.strength;
    } else {
      // Face-down: strength 2, or 4 with Escalation
      total += hasEscalation ? 4 : 2;
    }
  }

  // Support (air-1): if active, +3 to each adjacent theater (based on where it's placed)
  const supportTheater = findCardTheater(round, "air-1", playerId);
  if (supportTheater && theater !== supportTheater) {
    if (adjacentTheaters(supportTheater, round.theaterOrder).includes(theater)) {
      total += 3;
    }
  }

  return total;
}

// ============================================================
// Round resolution
// ============================================================

/** Determine who wins each theater and the round. Returns the round winner. */
export function resolveRound(
  round: RoundState,
  firstPlayer: PlayerId,
): { theaterWinners: Record<Theater, PlayerId>; roundWinner: PlayerId } {
  const theaterWinners: Record<string, PlayerId> = {};

  for (const theater of THEATERS) {
    const strengths = PLAYERS.map((p) => theaterStrength(round, theater, p));
    if (strengths[0] > strengths[1]) {
      theaterWinners[theater] = "player-0";
    } else if (strengths[1] > strengths[0]) {
      theaterWinners[theater] = "player-1";
    } else {
      // Tie: won by the first player (the player who went first this round)
      theaterWinners[theater] = firstPlayer;
    }
  }

  // Win 2 of 3 theaters
  const p0Wins = THEATERS.filter((t) => theaterWinners[t] === "player-0").length;
  const roundWinner = p0Wins >= 2 ? "player-0" : "player-1";

  return {
    theaterWinners: theaterWinners as Record<Theater, PlayerId>,
    roundWinner,
  };
}

/** Points scored on withdrawal based on cards remaining and whether the withdrawing player is 1st or 2nd. */
export function withdrawalPoints(cardsRemaining: number, isFirstPlayer: boolean): number {
  if (isFirstPlayer) {
    // 1st player: 4-6 → 2, 2-3 → 3, 1 → 4, 0 → 6
    if (cardsRemaining >= 4) return 2;
    if (cardsRemaining >= 2) return 3;
    if (cardsRemaining >= 1) return 4;
    return 6;
  } else {
    // 2nd player: 5-6 → 2, 3-4 → 3, 2 → 4, 0-1 → 6
    if (cardsRemaining >= 5) return 2;
    if (cardsRemaining >= 3) return 3;
    if (cardsRemaining >= 2) return 4;
    return 6;
  }
}
