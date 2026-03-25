import type { GameDefinition } from "../../engine.js";
import type { PlayerId } from "../../types.js";
import type { SeededRng } from "../../random.js";
import type {
  ALSState,
  ALSAction,
  ALSView,
  RoundState,
  Theater,
  PlayedCardView,
  PendingAbilityView,
} from "./types.js";
import { ALL_CARDS, getCard, adjacentTheaters } from "./cards.js";
import {
  resolveRound,
  theaterStrength,
  withdrawalPoints,
  isOngoingActiveForPlayer,
  isOngoingActiveForAny,
} from "./scoring.js";

const THEATERS: Theater[] = ["air", "land", "sea"];
const PLAYERS: PlayerId[] = ["player-0", "player-1"];

function otherPlayer(p: PlayerId): PlayerId {
  return p === "player-0" ? "player-1" : "player-0";
}

function cardLabel(cardId: string): string {
  const card = getCard(cardId);
  return `${card.name} (${card.strength})`;
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

function endRound(
  state: ALSState,
  winner: PlayerId,
  points: number,
): ALSState {
  const newScores = { ...state.scores };
  newScores[winner] = (newScores[winner] ?? 0) + points;
  const gameOver = newScores[winner] >= 12;

  return {
    ...state,
    scores: newScores,
    round: null,
    phase: gameOver ? "game-over" : "round-over",
    lastRoundWinner: winner,
  };
}

export const alsGame: GameDefinition<ALSState, ALSAction, ALSView> = {
  meta: {
    id: "air-land-sea",
    name: "Air, Land & Sea",
    minPlayers: 2,
    maxPlayers: 2,
  },

  setup(playerCount: number, rng: SeededRng): ALSState {
    const firstPlayer: PlayerId = "player-0";
    return {
      scores: { "player-0": 0, "player-1": 0 },
      round: dealRound(rng, firstPlayer),
      phase: "playing",
      firstPlayer,
      roundNumber: 1,
      lastRoundWinner: null,
    };
  },

  reducer(
    state: ALSState,
    action: ALSAction,
    playerId: PlayerId,
    rng: SeededRng,
  ): ALSState {
    if (action.type === "start-next-round") {
      const firstPlayer = otherPlayer(state.firstPlayer);
      return {
        ...state,
        round: dealRound(rng, firstPlayer),
        phase: "playing",
        firstPlayer,
        roundNumber: state.roundNumber + 1,
      };
    }

    if (action.type === "withdraw") {
      const round = structuredClone(state.round!);
      const cardsRemaining = round.hands[playerId].length;
      const isFirstPlayer = playerId === state.firstPlayer;
      const points = withdrawalPoints(cardsRemaining, isFirstPlayer);
      const winner = otherPlayer(playerId);
      const msg = `Withdrew (${points} pts to opponent)`;
      round.log.push({ playerId, text: msg, publicText: msg });
      return endRound({ ...state, round }, winner, points);
    }

    if (action.type === "play") {
      const round = structuredClone(state.round!);
      const hand = round.hands[playerId];
      const cardIndex = hand.indexOf(action.cardId);
      hand.splice(cardIndex, 1);

      // Place card in theater
      round.theaters[action.theater].stacks[playerId].push({
        cardId: action.cardId,
        faceUp: action.faceUp,
      });

      round.lastPlayerToPlay = playerId;

      // Log the play
      if (action.faceUp) {
        const label = cardLabel(action.cardId);
        round.log.push({
          playerId,
          text: `Played ${label} face-up to ${action.theater}`,
          publicText: `Played ${label} face-up to ${action.theater}`,
        });
      } else {
        round.log.push({
          playerId,
          text: `Played ${cardLabel(action.cardId)} face-down to ${action.theater}`,
          publicText: `Played a card face-down to ${action.theater}`,
        });
      }

      // Clear air drop flag if this player used it (or just consumed the turn)
      if (round.airDropNextTurn === playerId) {
        round.airDropNextTurn = null;
      }

      // Check ongoing abilities that react to card placement
      if (!action.faceUp) {
        // Containment (air-5): discard face-down cards
        if (isOngoingActiveForAny(round, "air-5")) {
          // Remove the card we just placed
          const stack = round.theaters[action.theater].stacks[playerId];
          stack.pop();
          // Card is discarded (put at bottom of deck)
          round.deck.push(action.cardId);
        }
      }

      if (action.faceUp || !isOngoingActiveForAny(round, "air-5")) {
        // Blockade (sea-5): discard cards played to adjacent theater with 3+ cards
        if (isOngoingActiveForAny(round, "sea-5") && adjacentTheaters("sea", round.theaterOrder).includes(action.theater)) {
          const totalCards =
            round.theaters[action.theater].stacks["player-0"].length +
            round.theaters[action.theater].stacks["player-1"].length;
          // The card was already added, so check if there were 3+ before (totalCards > 3 means 3+ before)
          // Actually: we need to check if the theater already had 3+ cards BEFORE this one was added.
          // totalCards includes the new card, so "3+ before" means totalCards >= 4
          if (totalCards >= 4) {
            const stack = round.theaters[action.theater].stacks[playerId];
            stack.pop();
            round.deck.push(action.cardId);
          }
        }
      }

      // Handle instant abilities for face-up cards
      if (action.faceUp) {
        const card = getCard(action.cardId);
        if (card.abilityType === "instant") {
          const abilityResult = triggerInstantAbility(round, action.cardId, action.theater, playerId);
          if (abilityResult) {
            round.pendingAbility = abilityResult;
          }
        }
      }

      // Check if round is over (both hands empty, no pending ability)
      if (!round.pendingAbility) {
        const p0Empty = round.hands["player-0"].length === 0;
        const p1Empty = round.hands["player-1"].length === 0;

        if (p0Empty && p1Empty) {
          const { roundWinner } = resolveRound(round, state.firstPlayer);
          return endRound({ ...state, round }, roundWinner, 6);
        }

        // Advance turn
        round.currentPlayer = otherPlayer(playerId);
      }

      return { ...state, round };
    }

    // Handle ability resolution actions
    if (state.round?.pendingAbility) {
      return resolveAbility(state, action, playerId);
    }

    return state;
  },

  view(state: ALSState, playerId: PlayerId): ALSView {
    const opponent = otherPlayer(playerId);
    const round = state.round;

    if (!round) {
      return {
        myPlayerId: playerId,
        myHand: [],
        theaters: emptyTheaterViews(),
        currentPlayer: "player-0",
        scores: { ...state.scores },
        phase: state.phase,
        roundNumber: state.roundNumber,
        opponentHandSize: 0,
        pendingAbility: null,
        theaterStrengths: emptyStrengths(),
        lastRoundWinner: state.lastRoundWinner,
        airDropActive: false,
        aerodromeActive: false,
        log: [],
        theaterOrder: ["air", "land", "sea"],
        isFirstPlayer: false,
      };
    }

    return {
      myPlayerId: playerId,
      myHand: [...round.hands[playerId]],
      theaters: buildTheaterViews(round, playerId),
      currentPlayer: round.currentPlayer,
      scores: { ...state.scores },
      phase: state.phase,
      roundNumber: state.roundNumber,
      opponentHandSize: round.hands[opponent].length,
      pendingAbility: buildPendingAbilityView(round.pendingAbility, playerId),
      theaterStrengths: buildStrengths(round),
      lastRoundWinner: state.lastRoundWinner,
      airDropActive: round.airDropNextTurn === playerId,
      aerodromeActive: isOngoingActiveForPlayer(round, "air-4", playerId),
      log: buildLog(round.log, playerId),
      theaterOrder: round.theaterOrder,
      isFirstPlayer: playerId === state.firstPlayer,
    };
  },

  spectatorView(state: ALSState): ALSView {
    const round = state.round;
    if (!round) {
      return {
        myPlayerId: null,
        myHand: [],
        theaters: emptyTheaterViews(),
        currentPlayer: "player-0",
        scores: { ...state.scores },
        phase: state.phase,
        roundNumber: state.roundNumber,
        opponentHandSize: 0,
        pendingAbility: null,
        theaterStrengths: emptyStrengths(),
        lastRoundWinner: state.lastRoundWinner,
        airDropActive: false,
        aerodromeActive: false,
        log: [],
        theaterOrder: ["air", "land", "sea"],
        isFirstPlayer: false,
      };
    }

    return {
      myPlayerId: null,
      myHand: [],
      theaters: buildTheaterViews(round, null),
      currentPlayer: round.currentPlayer,
      scores: { ...state.scores },
      phase: state.phase,
      roundNumber: state.roundNumber,
      opponentHandSize: 0,
      pendingAbility: null,
      theaterStrengths: buildStrengths(round),
      lastRoundWinner: state.lastRoundWinner,
      airDropActive: false,
      aerodromeActive: false,
      log: buildLog(round.log, null),
      theaterOrder: round.theaterOrder,
      isFirstPlayer: false,
    };
  },

  validateAction(
    state: ALSState,
    action: ALSAction,
    playerId: PlayerId,
  ): string | null {
    if (action.type === "start-next-round") {
      if (state.phase === "game-over") return "Game is over";
      if (state.phase !== "round-over") return "Round is not over";
      return null;
    }

    if (state.phase !== "playing") return "Game is not in playing phase";
    const round = state.round;
    if (!round) return "No active round";

    // If there's a pending ability, only ability resolution actions are allowed
    if (round.pendingAbility) {
      return validateAbilityAction(round, action, playerId);
    }

    if (action.type === "withdraw") {
      if (playerId !== round.currentPlayer) return "Not your turn";
      return null;
    }

    if (action.type === "play") {
      if (playerId !== round.currentPlayer) return "Not your turn";
      if (!isValidTheater(action.theater)) return "Invalid theater";
      if (!round.hands[playerId].includes(action.cardId)) {
        return "Card is not in your hand";
      }
      if (action.faceUp) {
        const card = getCard(action.cardId);
        const canPlayOffTheater =
          // Air Drop: one-turn ability to play face-up to non-matching theater
          round.airDropNextTurn === playerId ||
          // Aerodrome: ongoing, cards strength <= 3 can be played face-up anywhere
          (card.strength <= 3 && isOngoingActiveForPlayer(round, "air-4", playerId));

        if (card.theater !== action.theater && !canPlayOffTheater) {
          return "Face-up cards must be played to their matching theater";
        }
      }
      return null;
    }

    return "Invalid action type";
  },

  getWinner(state: ALSState): PlayerId[] | null {
    if (state.phase !== "game-over") return null;
    const p0 = state.scores["player-0"] ?? 0;
    const p1 = state.scores["player-1"] ?? 0;
    if (p0 > p1) return ["player-0"];
    if (p1 > p0) return ["player-1"];
    // Unreachable: only one player scores per round, so tied scores at game-over
    // cannot happen through endRound(). If this somehow triggers, it's a bug.
    throw new Error(`Unexpected tied scores at game-over: ${p0}-${p1}`);
  },

  activePlayerIds(state: ALSState): PlayerId[] {
    if (state.phase === "game-over") return [];
    if (state.phase === "round-over") return PLAYERS; // either can start next round
    const round = state.round;
    if (!round) return [];
    if (round.pendingAbility) return [round.pendingAbility.playerId];
    return [round.currentPlayer];
  },
};

// -- Helpers --

const VALID_THEATERS = new Set<string>(["air", "land", "sea"]);
const VALID_PLAYERS = new Set<string>(["player-0", "player-1"]);

function isValidTheater(value: unknown): value is Theater {
  return typeof value === "string" && VALID_THEATERS.has(value);
}

function isValidPlayer(value: unknown): value is PlayerId {
  return typeof value === "string" && VALID_PLAYERS.has(value);
}

/** A card is uncovered if it's the top card in its stack. Covered cards cannot be flipped. */
function isUncovered(stack: { cardId: string; faceUp: boolean }[], cardIndex: number): boolean {
  return cardIndex === stack.length - 1;
}


/** Count total cards in given theaters for any/all players. */
function hasCardsInTheaters(round: RoundState, theaters: Theater[]): boolean {
  for (const t of theaters) {
    for (const p of PLAYERS) {
      if (round.theaters[t].stacks[p].length > 0) return true;
    }
  }
  return false;
}

/** Check if a player has any cards on the board (any theater). */
function hasCardsOnBoard(round: RoundState, playerId: PlayerId): boolean {
  for (const t of THEATERS) {
    if (round.theaters[t].stacks[playerId].length > 0) return true;
  }
  return false;
}

/** Check if a player has any face-down cards on the board. */
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
    case "air-2": // Air Drop — set flag for next turn
      round.airDropNextTurn = playerId;
      return null;
    case "air-3": // Maneuver (air) — flip in adjacent theater
    case "land-3": // Maneuver (land)
    case "sea-3": { // Maneuver (sea)
      const adjacent = adjacentTheaters(theater, round.theaterOrder);
      if (!hasCardsInTheaters(round, adjacent)) return null;
      return { type: "maneuver", playerId, adjacentTheaters: adjacent };
    }
    case "land-2": // Ambush — flip in any theater
      if (!hasCardsInTheaters(round, THEATERS)) return null;
      return { type: "ambush", playerId };
    case "land-1": // Reinforce — peek top card, optionally play face-down adjacent
      if (round.deck.length === 0) return null;
      return {
        type: "reinforce",
        playerId,
        topCard: round.deck[0],
        adjacentTheaters: adjacentTheaters(theater, round.theaterOrder),
      };
    case "land-5": { // Disrupt — opponent flips, then you flip
      const opponent = otherPlayer(playerId);
      if (!hasCardsOnBoard(round, opponent)) return null;
      return { type: "disrupt-opponent", playerId: opponent };
    }
    case "sea-1": { // Transport — move one of your cards (excluding the just-played Transport)
      // Count player's cards across all theaters, minus the one we just placed
      let cardCount = 0;
      for (const t of THEATERS) {
        cardCount += round.theaters[t].stacks[playerId].length;
      }
      // The Transport card itself was just added, so we need at least 2 cards total
      if (cardCount < 2) return null;
      return { type: "transport", playerId };
    }
    case "sea-4": // Redeploy — pick up a face-down card, extra turn
      if (!hasFaceDownCards(round, playerId)) return null;
      return { type: "redeploy", playerId };
    default:
      return null;
  }
}

function resolveAbility(
  state: ALSState,
  action: ALSAction,
  playerId: PlayerId,
): ALSState {
  const round = structuredClone(state.round!);
  const pending = round.pendingAbility!;

  switch (pending.type) {
    case "maneuver":
    case "ambush": {
      if (action.type !== "choose-flip") return state;
      const stack = round.theaters[action.theater].stacks[action.cardOwner];
      const flippedCard = stack[action.cardIndex];
      const newFaceUp = !flippedCard.faceUp;
      stack[action.cardIndex] = { ...flippedCard, faceUp: newFaceUp };
      const label = cardLabel(flippedCard.cardId);
      const direction = newFaceUp ? "face-up" : "face-down";
      const msg = `Flipped ${label} in ${action.theater} ${direction}`;
      round.log.push({ playerId, text: msg, publicText: msg });
      round.pendingAbility = null;
      break;
    }

    case "transport": {
      if (action.type !== "choose-transport") return state;
      const fromStack = round.theaters[action.fromTheater].stacks[playerId];
      const [card] = fromStack.splice(action.cardIndex, 1);
      round.theaters[action.toTheater].stacks[playerId].push(card);
      const label = card.faceUp ? cardLabel(card.cardId) : "a card";
      const msg = `Moved ${label} from ${action.fromTheater} to ${action.toTheater}`;
      round.log.push({
        playerId,
        text: `Moved ${cardLabel(card.cardId)} from ${action.fromTheater} to ${action.toTheater}`,
        publicText: msg,
      });
      round.pendingAbility = null;
      break;
    }

    case "reinforce": {
      if (action.type !== "choose-reinforce") return state;
      if (action.play && action.theater) {
        const topCard = round.deck.shift()!;
        // Containment check: face-down card is discarded if Containment is active
        if (isOngoingActiveForAny(round, "air-5")) {
          round.deck.push(topCard);
          round.log.push({
            playerId,
            text: `Reinforced ${cardLabel(topCard)} to ${action.theater} — discarded by Containment`,
            publicText: `Reinforced a card to ${action.theater} — discarded by Containment`,
          });
        } else {
          round.theaters[action.theater].stacks[playerId].push({
            cardId: topCard,
            faceUp: false,
          });
          round.log.push({
            playerId,
            text: `Reinforced ${cardLabel(topCard)} face-down to ${action.theater}`,
            publicText: `Reinforced a card face-down to ${action.theater}`,
          });
        }
      } else {
        round.log.push({ playerId, text: "Declined to reinforce", publicText: "Declined to reinforce" });
      }
      round.pendingAbility = null;
      break;
    }

    case "redeploy": {
      if (action.type !== "choose-redeploy") return state;
      const stack = round.theaters[action.theater].stacks[playerId];
      const [card] = stack.splice(action.cardIndex, 1);
      round.hands[playerId].push(card.cardId);
      round.log.push({
        playerId,
        text: `Redeployed ${cardLabel(card.cardId)} from ${action.theater} to hand`,
        publicText: `Redeployed a card from ${action.theater} to hand`,
      });
      round.pendingAbility = null;
      // Extra turn: don't advance current player
      return { ...state, round };
    }

    case "disrupt-opponent": {
      if (action.type !== "choose-disrupt-flip") return state;
      const stack = round.theaters[action.theater].stacks[playerId];
      const flippedCard = stack[action.cardIndex];
      const newFaceUp = !flippedCard.faceUp;
      stack[action.cardIndex] = { ...flippedCard, faceUp: newFaceUp };
      const label = cardLabel(flippedCard.cardId);
      const msg = `Flipped own ${label} in ${action.theater} ${newFaceUp ? "face-up" : "face-down"} (Disrupt)`;
      round.log.push({ playerId, text: msg, publicText: msg });
      // Transition to disrupt-self (the original player who played Disrupt)
      round.pendingAbility = {
        type: "disrupt-self",
        playerId: otherPlayer(playerId),
      };
      return { ...state, round };
    }

    case "disrupt-self": {
      if (action.type !== "choose-disrupt-flip") return state;
      const stack = round.theaters[action.theater].stacks[playerId];
      const flippedCard2 = stack[action.cardIndex];
      const newFaceUp2 = !flippedCard2.faceUp;
      stack[action.cardIndex] = { ...flippedCard2, faceUp: newFaceUp2 };
      const label2 = cardLabel(flippedCard2.cardId);
      const msg2 = `Flipped own ${label2} in ${action.theater} ${newFaceUp2 ? "face-up" : "face-down"} (Disrupt)`;
      round.log.push({ playerId, text: msg2, publicText: msg2 });
      round.pendingAbility = null;
      break;
    }

    default:
      return state;
  }

  // After ability resolution, check round end or advance turn
  const p0Empty = round.hands["player-0"].length === 0;
  const p1Empty = round.hands["player-1"].length === 0;

  if (p0Empty && p1Empty) {
    const { roundWinner } = resolveRound(round, state.firstPlayer);
    return endRound({ ...state, round }, roundWinner, 6);
  }

  round.currentPlayer = otherPlayer(round.currentPlayer);
  return { ...state, round };
}

function validateAbilityAction(
  round: RoundState,
  action: ALSAction,
  playerId: PlayerId,
): string | null {
  const pending = round.pendingAbility!;

  if (playerId !== pending.playerId) {
    return "Not your turn to resolve this ability";
  }

  switch (pending.type) {
    case "maneuver": {
      if (action.type !== "choose-flip") return "Must choose a card to flip";
      if (!isValidTheater(action.theater)) return "Invalid theater";
      if (!isValidPlayer(action.cardOwner)) return "Invalid card owner";
      if (!pending.adjacentTheaters.includes(action.theater)) {
        return "Must flip a card in an adjacent theater";
      }
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
        if (!pending.adjacentTheaters.includes(action.theater)) {
          return "Must play to an adjacent theater";
        }
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

function buildTheaterViews(
  round: RoundState,
  viewingPlayer: PlayerId | null,
): Record<Theater, { stacks: Record<PlayerId, PlayedCardView[]> }> {
  const result: Record<string, { stacks: Record<PlayerId, PlayedCardView[]> }> = {};
  for (const theater of THEATERS) {
    const stacks: Record<string, PlayedCardView[]> = {};
    for (const player of PLAYERS) {
      stacks[player] = round.theaters[theater].stacks[player].map((pc) => ({
        cardId:
          pc.faceUp || player === viewingPlayer ? pc.cardId : null,
        faceUp: pc.faceUp,
      }));
    }
    result[theater] = { stacks: stacks as Record<PlayerId, PlayedCardView[]> };
  }
  return result as Record<Theater, { stacks: Record<PlayerId, PlayedCardView[]> }>;
}

function buildPendingAbilityView(
  pending: RoundState["pendingAbility"],
  playerId: PlayerId,
): PendingAbilityView | null {
  if (!pending) return null;
  switch (pending.type) {
    case "maneuver":
      return { type: "maneuver", playerId: pending.playerId, adjacentTheaters: pending.adjacentTheaters };
    case "reinforce":
      return {
        type: "reinforce",
        playerId: pending.playerId,
        topCard: pending.playerId === playerId ? pending.topCard : null,
        adjacentTheaters: pending.adjacentTheaters,
      };
    default:
      return { type: pending.type, playerId: pending.playerId } as PendingAbilityView;
  }
}

function buildLog(
  log: import("./types.js").LogEntry[],
  viewingPlayer: PlayerId | null,
): string[] {
  return log.map((entry) => {
    const isMe = entry.playerId === viewingPlayer;
    const prefix = isMe ? "You" : entry.playerId;
    const text = isMe ? entry.text : entry.publicText;
    return `${prefix}: ${text}`;
  });
}

function buildStrengths(
  round: RoundState,
): Record<Theater, Record<PlayerId, number>> {
  const result: Record<string, Record<string, number>> = {};
  for (const theater of THEATERS) {
    result[theater] = {};
    for (const player of PLAYERS) {
      result[theater][player] = theaterStrength(round, theater, player);
    }
  }
  return result as Record<Theater, Record<PlayerId, number>>;
}

function emptyTheaterViews(): Record<Theater, { stacks: Record<PlayerId, PlayedCardView[]> }> {
  const result: Record<string, { stacks: Record<PlayerId, PlayedCardView[]> }> = {};
  for (const theater of THEATERS) {
    result[theater] = {
      stacks: { "player-0": [], "player-1": [] },
    };
  }
  return result as Record<Theater, { stacks: Record<PlayerId, PlayedCardView[]> }>;
}

function emptyStrengths(): Record<Theater, Record<PlayerId, number>> {
  const result: Record<string, Record<string, number>> = {};
  for (const theater of THEATERS) {
    result[theater] = { "player-0": 0, "player-1": 0 };
  }
  return result as Record<Theater, Record<PlayerId, number>>;
}
