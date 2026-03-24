import type { PlayerId } from "../../types.js";
import type { RoundState, Theater } from "./types.js";
import { getCard, adjacentTheaters } from "./cards.js";

const THEATERS: Theater[] = ["air", "land", "sea"];
const PLAYERS: PlayerId[] = ["player-0", "player-1"];

// ============================================================
// Ongoing ability checks — single source of truth.
// An ongoing ability is active when its card is the top
// (uncovered) card in a stack and face-up.
// ============================================================

/** Is a card the top (uncovered) and face-up card in its stack? */
function isTopAndFaceUp(
  stack: { cardId: string; faceUp: boolean }[],
  cardId: string,
): boolean {
  if (stack.length === 0) return false;
  const top = stack[stack.length - 1];
  return top.cardId === cardId && top.faceUp;
}

/** Is an ongoing ability active for a specific player (in any theater)? */
export function isOngoingActiveForPlayer(
  round: RoundState,
  cardId: string,
  playerId: PlayerId,
): boolean {
  for (const theater of THEATERS) {
    if (isTopAndFaceUp(round.theaters[theater].stacks[playerId], cardId)) {
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

  // Cover Fire: if it's the top card in this theater, cards below it become str 4.
  const coverFireActive = isTopAndFaceUp(stack, "land-4");
  const coverFireIndex = coverFireActive ? stack.length - 1 : -1;

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

  // Support (air-1): if active, +3 to each adjacent theater
  if (theater !== "air" && isOngoingActiveForPlayer(round, "air-1", playerId)) {
    if (adjacentTheaters("air").includes(theater)) {
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
): { theaterWinners: Record<Theater, PlayerId>; roundWinner: PlayerId } {
  const theaterWinners: Record<string, PlayerId> = {};

  for (const theater of THEATERS) {
    const strengths = PLAYERS.map((p) => theaterStrength(round, theater, p));
    if (strengths[0] > strengths[1]) {
      theaterWinners[theater] = "player-0";
    } else if (strengths[1] > strengths[0]) {
      theaterWinners[theater] = "player-1";
    } else {
      // Tie: won by the player who did NOT play last
      const lastPlayer = round.lastPlayerToPlay ?? "player-1";
      theaterWinners[theater] = lastPlayer === "player-0" ? "player-1" : "player-0";
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

/** Points scored on withdrawal based on cards remaining in hand. */
export function withdrawalPoints(cardsRemaining: number): number {
  if (cardsRemaining >= 5) return 2;
  if (cardsRemaining >= 3) return 3;
  if (cardsRemaining >= 1) return 4;
  return 6; // 0 cards = full play-through
}
