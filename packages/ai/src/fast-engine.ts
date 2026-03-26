/**
 * Mutable (fast) game engine for training only.
 *
 * This is a fork of the ALS game logic that mutates state in-place
 * instead of using structuredClone + immutable returns. It also skips
 * building log entries since training doesn't need them.
 *
 * NOT for use in the web app — only for self-play training.
 */

import type { PlayerId } from "@card-games/shared/types.ts";
import type { SeededRng } from "@card-games/shared/random.ts";
import type {
  ALSState,
  ALSAction,
  ALSView,
  RoundState,
  Theater,
  PendingAbilityView,
} from "@card-games/shared/games/air-land-sea/types.ts";
import { ALL_CARDS, getCard, adjacentTheaters } from "@card-games/shared/games/air-land-sea/cards.ts";
import {
  resolveRound,
  theaterStrength,
  withdrawalPoints,
  isOngoingActiveForPlayer,
  isOngoingActiveForAny,
} from "@card-games/shared/games/air-land-sea/scoring.ts";

const THEATERS: Theater[] = ["air", "land", "sea"];
const PLAYERS: PlayerId[] = ["player-0", "player-1"];

function otherPlayer(p: PlayerId): PlayerId {
  return p === "player-0" ? "player-1" : "player-0";
}

function dealRound(rng: SeededRng, firstPlayer: PlayerId): RoundState {
  const cardIds = rng.shuffle(ALL_CARDS.map((c) => c.id));
  const theaterOrder = rng.shuffle<Theater>(["air", "land", "sea"]);
  return {
    theaterOrder,
    theaters: {
      air: { stacks: { "player-0": [], "player-1": [] } },
      land: { stacks: { "player-0": [], "player-1": [] } },
      sea: { stacks: { "player-0": [], "player-1": [] } },
    },
    hands: {
      "player-0": cardIds.slice(0, 6),
      "player-1": cardIds.slice(6, 12),
    },
    deck: cardIds.slice(12, 18),
    currentPlayer: firstPlayer,
    lastPlayerToPlay: null,
    airDropNextTurn: null,
    pendingAbility: null,
    log: [],
  };
}

function endRound(state: ALSState, winner: PlayerId, points: number): ALSState {
  state.scores[winner] = (state.scores[winner] ?? 0) + points;
  const gameOver = state.scores[winner] >= 12;
  state.round = null;
  state.phase = gameOver ? "game-over" : "round-over";
  state.lastRoundWinner = winner;
  return state;
}

// ============================================================
// Helpers (same as original, read-only)
// ============================================================

function hasCardsInTheaters(round: RoundState, theaters: Theater[]): boolean {
  for (const t of theaters) {
    for (const p of PLAYERS) {
      if (round.theaters[t].stacks[p].length > 0) return true;
    }
  }
  return false;
}

function hasCardsOnBoard(round: RoundState, playerId: PlayerId): boolean {
  for (const t of THEATERS) {
    if (round.theaters[t].stacks[playerId].length > 0) return true;
  }
  return false;
}

function hasFaceDownCards(round: RoundState, playerId: PlayerId): boolean {
  for (const t of THEATERS) {
    for (const card of round.theaters[t].stacks[playerId]) {
      if (!card.faceUp) return true;
    }
  }
  return false;
}

function triggerInstantAbility(
  round: RoundState,
  cardId: string,
  theater: Theater,
  playerId: PlayerId,
): RoundState["pendingAbility"] {
  switch (cardId) {
    case "air-2":
      round.airDropNextTurn = playerId;
      return null;
    case "air-3":
    case "land-3":
    case "sea-3": {
      const adjacent = adjacentTheaters(theater, round.theaterOrder);
      if (!hasCardsInTheaters(round, adjacent)) return null;
      return { type: "maneuver", playerId, adjacentTheaters: adjacent };
    }
    case "land-2":
      if (!hasCardsInTheaters(round, THEATERS)) return null;
      return { type: "ambush", playerId };
    case "land-1":
      if (round.deck.length === 0) return null;
      return {
        type: "reinforce",
        playerId,
        topCard: round.deck[0],
        adjacentTheaters: adjacentTheaters(theater, round.theaterOrder),
      };
    case "land-5": {
      const opponent = otherPlayer(playerId);
      if (!hasCardsOnBoard(round, opponent)) return null;
      return { type: "disrupt-opponent", playerId: opponent };
    }
    case "sea-1": {
      let cardCount = 0;
      for (const t of THEATERS) {
        cardCount += round.theaters[t].stacks[playerId].length;
      }
      if (cardCount < 2) return null;
      return { type: "transport", playerId };
    }
    case "sea-4":
      if (!hasFaceDownCards(round, playerId)) return null;
      return { type: "redeploy", playerId };
    default:
      return null;
  }
}

function triggerFlippedCardAbility(
  round: RoundState,
  theater: Theater,
  cardOwner: PlayerId,
  cardIndex: number,
): void {
  const card = round.theaters[theater].stacks[cardOwner][cardIndex];
  if (!card.faceUp) return;
  const cardDef = getCard(card.cardId);
  if (cardDef.abilityType !== "instant") return;
  const triggered = triggerInstantAbility(round, card.cardId, theater, cardOwner);
  if (triggered) {
    round.pendingAbility = triggered;
  }
}

// ============================================================
// Mutable reducer
// ============================================================

function reducer(
  state: ALSState,
  action: ALSAction,
  playerId: PlayerId,
  rng: SeededRng,
): ALSState {
  if (action.type === "start-next-round") {
    state.firstPlayer = otherPlayer(state.firstPlayer);
    state.round = dealRound(rng, state.firstPlayer);
    state.phase = "playing";
    state.roundNumber++;
    return state;
  }

  if (action.type === "withdraw") {
    const round = state.round!;
    const cardsRemaining = round.hands[playerId].length;
    const isFirstPlayer = playerId === state.firstPlayer;
    const points = withdrawalPoints(cardsRemaining, isFirstPlayer);
    const winner = otherPlayer(playerId);
    return endRound(state, winner, points);
  }

  if (action.type === "play") {
    const round = state.round!;
    const hand = round.hands[playerId];
    const cardIndex = hand.indexOf(action.cardId);
    hand.splice(cardIndex, 1);

    round.theaters[action.theater].stacks[playerId].push({
      cardId: action.cardId,
      faceUp: action.faceUp,
    });

    round.lastPlayerToPlay = playerId;

    if (round.airDropNextTurn === playerId) {
      round.airDropNextTurn = null;
    }

    // Containment
    if (!action.faceUp) {
      if (isOngoingActiveForAny(round, "air-5")) {
        const stack = round.theaters[action.theater].stacks[playerId];
        stack.pop();
        round.deck.push(action.cardId);
      }
    }

    // Blockade
    if (action.faceUp || !isOngoingActiveForAny(round, "air-5")) {
      if (isOngoingActiveForAny(round, "sea-5") && adjacentTheaters("sea", round.theaterOrder).includes(action.theater)) {
        const totalCards =
          round.theaters[action.theater].stacks["player-0"].length +
          round.theaters[action.theater].stacks["player-1"].length;
        if (totalCards >= 4) {
          const stack = round.theaters[action.theater].stacks[playerId];
          stack.pop();
          round.deck.push(action.cardId);
        }
      }
    }

    // Instant abilities
    if (action.faceUp) {
      const card = getCard(action.cardId);
      if (card.abilityType === "instant") {
        const abilityResult = triggerInstantAbility(round, action.cardId, action.theater, playerId);
        if (abilityResult) {
          round.pendingAbility = abilityResult;
        }
      }
    }

    // Round end check
    if (!round.pendingAbility) {
      if (round.hands["player-0"].length === 0 && round.hands["player-1"].length === 0) {
        const { roundWinner } = resolveRound(round, state.firstPlayer);
        return endRound(state, roundWinner, 6);
      }
      round.currentPlayer = otherPlayer(playerId);
    }

    return state;
  }

  // Ability resolution
  if (state.round?.pendingAbility) {
    return resolveAbility(state, action, playerId);
  }

  return state;
}

function resolveAbility(
  state: ALSState,
  action: ALSAction,
  playerId: PlayerId,
): ALSState {
  const round = state.round!;
  const pending = round.pendingAbility!;

  switch (pending.type) {
    case "maneuver":
    case "ambush": {
      if (action.type !== "choose-flip") return state;
      const stack = round.theaters[action.theater].stacks[action.cardOwner];
      const flippedCard = stack[action.cardIndex];
      flippedCard.faceUp = !flippedCard.faceUp;
      round.pendingAbility = null;
      if (flippedCard.faceUp) {
        triggerFlippedCardAbility(round, action.theater, action.cardOwner, action.cardIndex);
      }
      if (round.pendingAbility) return state;
      break;
    }

    case "transport": {
      if (action.type !== "choose-transport") return state;
      const fromStack = round.theaters[action.fromTheater].stacks[playerId];
      const [card] = fromStack.splice(action.cardIndex, 1);
      round.theaters[action.toTheater].stacks[playerId].push(card);
      round.pendingAbility = null;
      break;
    }

    case "reinforce": {
      if (action.type !== "choose-reinforce") return state;
      if (action.play && action.theater) {
        const topCard = round.deck.shift()!;
        if (isOngoingActiveForAny(round, "air-5")) {
          round.deck.push(topCard);
        } else {
          round.theaters[action.theater].stacks[playerId].push({
            cardId: topCard,
            faceUp: false,
          });
        }
      }
      round.pendingAbility = null;
      break;
    }

    case "redeploy": {
      if (action.type !== "choose-redeploy") return state;
      const stack = round.theaters[action.theater].stacks[playerId];
      const [card] = stack.splice(action.cardIndex, 1);
      round.hands[playerId].push(card.cardId);
      round.pendingAbility = null;
      // Extra turn: don't advance current player
      return state;
    }

    case "disrupt-opponent": {
      if (action.type !== "choose-disrupt-flip") return state;
      const stack = round.theaters[action.theater].stacks[playerId];
      const flippedCard = stack[action.cardIndex];
      flippedCard.faceUp = !flippedCard.faceUp;
      if (flippedCard.faceUp) {
        triggerFlippedCardAbility(round, action.theater, playerId, action.cardIndex);
        if (round.pendingAbility) return state;
      }
      round.pendingAbility = {
        type: "disrupt-self",
        playerId: otherPlayer(playerId),
      };
      return state;
    }

    case "disrupt-self": {
      if (action.type !== "choose-disrupt-flip") return state;
      const stack = round.theaters[action.theater].stacks[playerId];
      const flippedCard = stack[action.cardIndex];
      flippedCard.faceUp = !flippedCard.faceUp;
      round.pendingAbility = null;
      if (flippedCard.faceUp) {
        triggerFlippedCardAbility(round, action.theater, playerId, action.cardIndex);
        if (round.pendingAbility) return state;
      }
      break;
    }

    default:
      return state;
  }

  // After ability resolution, check round end or advance turn
  if (round.hands["player-0"].length === 0 && round.hands["player-1"].length === 0) {
    const { roundWinner } = resolveRound(round, state.firstPlayer);
    return endRound(state, roundWinner, 6);
  }

  round.currentPlayer = otherPlayer(round.currentPlayer);
  return state;
}

// ============================================================
// Validation (unchanged — read-only)
// ============================================================

const VALID_THEATERS = new Set<string>(["air", "land", "sea"]);
const VALID_PLAYERS = new Set<string>(["player-0", "player-1"]);

function isValidTheater(value: unknown): value is Theater { return typeof value === "string" && VALID_THEATERS.has(value); }
function isValidPlayer(value: unknown): value is PlayerId { return typeof value === "string" && VALID_PLAYERS.has(value); }
function isUncovered(stack: { cardId: string; faceUp: boolean }[], cardIndex: number): boolean { return cardIndex === stack.length - 1; }

function validateAction(state: ALSState, action: ALSAction, playerId: PlayerId): string | null {
  if (action.type === "start-next-round") {
    if (state.phase === "game-over") return "Game is over";
    if (state.phase !== "round-over") return "Round is not over";
    return null;
  }
  if (state.phase !== "playing") return "Game is not in playing phase";
  const round = state.round;
  if (!round) return "No active round";
  if (round.pendingAbility) return validateAbilityAction(round, action, playerId);
  if (action.type === "withdraw") {
    if (playerId !== round.currentPlayer) return "Not your turn";
    return null;
  }
  if (action.type === "play") {
    if (playerId !== round.currentPlayer) return "Not your turn";
    if (!isValidTheater(action.theater)) return "Invalid theater";
    if (!round.hands[playerId].includes(action.cardId)) return "Card is not in your hand";
    if (action.faceUp) {
      const card = getCard(action.cardId);
      const canPlayOffTheater =
        round.airDropNextTurn === playerId ||
        (card.strength <= 3 && isOngoingActiveForPlayer(round, "air-4", playerId));
      if (card.theater !== action.theater && !canPlayOffTheater) return "Face-up cards must be played to their matching theater";
    }
    return null;
  }
  return "Invalid action type";
}

function validateAbilityAction(round: RoundState, action: ALSAction, playerId: PlayerId): string | null {
  const pending = round.pendingAbility!;
  if (playerId !== pending.playerId) return "Not your turn to resolve this ability";
  switch (pending.type) {
    case "maneuver": {
      if (action.type !== "choose-flip") return "Must choose a card to flip";
      if (!isValidTheater(action.theater)) return "Invalid theater";
      if (!isValidPlayer(action.cardOwner)) return "Invalid card owner";
      if (!pending.adjacentTheaters.includes(action.theater)) return "Must flip a card in an adjacent theater";
      const stack = round.theaters[action.theater].stacks[action.cardOwner];
      if (!stack[action.cardIndex]) return "No card at that position";
      if (!isUncovered(stack, action.cardIndex)) return "Cannot flip a covered card";
      return null;
    }
    case "ambush": {
      if (action.type !== "choose-flip") return "Must choose a card to flip";
      if (!isValidTheater(action.theater)) return "Invalid theater";
      if (!isValidPlayer(action.cardOwner)) return "Invalid card owner";
      const stack = round.theaters[action.theater].stacks[action.cardOwner];
      if (!stack[action.cardIndex]) return "No card at that position";
      if (!isUncovered(stack, action.cardIndex)) return "Cannot flip a covered card";
      return null;
    }
    case "transport": {
      if (action.type !== "choose-transport") return "Must choose a card to transport";
      if (!isValidTheater(action.fromTheater)) return "Invalid theater";
      if (!isValidTheater(action.toTheater)) return "Invalid theater";
      const stack = round.theaters[action.fromTheater].stacks[playerId];
      if (!stack[action.cardIndex]) return "No card at that position";
      if (action.fromTheater === action.toTheater) return "Must move to a different theater";
      return null;
    }
    case "reinforce": {
      if (action.type !== "choose-reinforce") return "Must choose whether to play the card";
      if (action.play && !action.theater) return "Must specify a theater";
      if (action.play && action.theater) {
        if (!isValidTheater(action.theater)) return "Invalid theater";
        if (!pending.adjacentTheaters.includes(action.theater)) return "Must play to an adjacent theater";
      }
      return null;
    }
    case "redeploy": {
      if (action.type !== "choose-redeploy") return "Must choose a card to redeploy";
      if (!isValidTheater(action.theater)) return "Invalid theater";
      const stack = round.theaters[action.theater].stacks[playerId];
      if (!stack[action.cardIndex]) return "No card at that position";
      if (stack[action.cardIndex].faceUp) return "Can only redeploy face-down cards";
      return null;
    }
    case "disrupt-opponent":
    case "disrupt-self": {
      if (action.type !== "choose-disrupt-flip") return "Must choose a card to flip";
      if (!isValidTheater(action.theater)) return "Invalid theater";
      const stack = round.theaters[action.theater].stacks[playerId];
      if (!stack[action.cardIndex]) return "No card at that position";
      if (!isUncovered(stack, action.cardIndex)) return "Cannot flip a covered card";
      return null;
    }
    default:
      return "Unknown pending ability";
  }
}

// ============================================================
// View (simplified — skips log building)
// ============================================================

function view(state: ALSState, playerId: PlayerId): ALSView {
  const opponent = otherPlayer(playerId);
  const round = state.round;

  if (!round) {
    return {
      myPlayerId: playerId, myHand: [], theaters: emptyTheaterViews(),
      currentPlayer: "player-0", scores: state.scores, phase: state.phase,
      roundNumber: state.roundNumber, opponentHandSize: 0, pendingAbility: null,
      theaterStrengths: emptyStrengths(), lastRoundWinner: state.lastRoundWinner,
      airDropActive: false, aerodromeActive: false, log: [],
      theaterOrder: ["air", "land", "sea"], isFirstPlayer: false,
    };
  }

  return {
    myPlayerId: playerId,
    myHand: round.hands[playerId],  // no copy needed — encoding reads but doesn't mutate
    theaters: buildTheaterViews(round, playerId),
    currentPlayer: round.currentPlayer,
    scores: state.scores,
    phase: state.phase,
    roundNumber: state.roundNumber,
    opponentHandSize: round.hands[opponent].length,
    pendingAbility: buildPendingAbilityView(round.pendingAbility, playerId),
    theaterStrengths: buildStrengths(round),
    lastRoundWinner: state.lastRoundWinner,
    airDropActive: round.airDropNextTurn === playerId,
    aerodromeActive: isOngoingActiveForPlayer(round, "air-4", playerId),
    log: [],  // skip log for training
    theaterOrder: round.theaterOrder,
    isFirstPlayer: playerId === state.firstPlayer,
  };
}

function buildTheaterViews(round: RoundState, viewingPlayer: PlayerId) {
  const result: Record<string, { stacks: Record<string, { cardId: string | null; faceUp: boolean }[]> }> = {};
  for (const theater of THEATERS) {
    const stacks: Record<string, { cardId: string | null; faceUp: boolean }[]> = {};
    for (const player of PLAYERS) {
      stacks[player] = round.theaters[theater].stacks[player].map((pc) => ({
        cardId: pc.faceUp || player === viewingPlayer ? pc.cardId : null,
        faceUp: pc.faceUp,
      }));
    }
    result[theater] = { stacks };
  }
  return result as any;
}

function buildPendingAbilityView(pending: RoundState["pendingAbility"], playerId: PlayerId): PendingAbilityView | null {
  if (!pending) return null;
  switch (pending.type) {
    case "maneuver":
      return { type: "maneuver", playerId: pending.playerId, adjacentTheaters: pending.adjacentTheaters };
    case "reinforce":
      return { type: "reinforce", playerId: pending.playerId, topCard: pending.playerId === playerId ? pending.topCard : null, adjacentTheaters: pending.adjacentTheaters };
    default:
      return { type: pending.type, playerId: pending.playerId } as PendingAbilityView;
  }
}

function buildStrengths(round: RoundState) {
  const result: Record<string, Record<string, number>> = {};
  for (const theater of THEATERS) {
    result[theater] = {};
    for (const player of PLAYERS) {
      result[theater][player] = theaterStrength(round, theater, player);
    }
  }
  return result as any;
}

function emptyTheaterViews() {
  const result: Record<string, any> = {};
  for (const theater of THEATERS) result[theater] = { stacks: { "player-0": [], "player-1": [] } };
  return result as any;
}

function emptyStrengths() {
  const result: Record<string, any> = {};
  for (const theater of THEATERS) result[theater] = { "player-0": 0, "player-1": 0 };
  return result as any;
}

// ============================================================
// Exported game definition (same interface as alsGame)
// ============================================================

import type { GameDefinition } from "@card-games/shared/engine.ts";

export const fastAlsGame: GameDefinition<ALSState, ALSAction, ALSView> = {
  meta: { id: "air-land-sea", name: "Air, Land & Sea", minPlayers: 2, maxPlayers: 2 },
  setup(playerCount: number, rng: SeededRng): ALSState {
    return {
      scores: { "player-0": 0, "player-1": 0 },
      round: dealRound(rng, "player-0"),
      phase: "playing",
      firstPlayer: "player-0",
      roundNumber: 1,
      lastRoundWinner: null,
    };
  },
  reducer,
  view,
  spectatorView: (state) => view(state, "player-0"),  // not used in training
  validateAction,
  getWinner(state: ALSState): PlayerId[] | null {
    if (state.phase !== "game-over") return null;
    const p0 = state.scores["player-0"] ?? 0;
    const p1 = state.scores["player-1"] ?? 0;
    if (p0 > p1) return ["player-0"];
    if (p1 > p0) return ["player-1"];
    throw new Error(`Unexpected tied scores: ${p0}-${p1}`);
  },
  activePlayerIds(state: ALSState): PlayerId[] {
    if (state.phase === "game-over") return [];
    if (state.phase === "round-over") return PLAYERS;
    const round = state.round;
    if (!round) return [];
    if (round.pendingAbility) return [round.pendingAbility.playerId];
    return [round.currentPlayer];
  },
};
