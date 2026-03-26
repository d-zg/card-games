/**
 * Heuristic bot for Air, Land & Sea.
 *
 * Follows basic strategy:
 * - Play face-up to matching theater when possible (prioritize high strength)
 * - Play face-down only when no face-up option helps
 * - Withdraw when hand is small and losing most theaters
 * - Resolve abilities sensibly (flip opponent's cards, not own)
 */

import type { ALSView, ALSAction, Theater, PlayedCardView } from "./types.js";
import type { PlayerId } from "../../types.js";
import { ALL_CARDS, getCard } from "./cards.js";
import type { BotPlayer } from "./local-game-controller.js";

const THEATERS: Theater[] = ["air", "land", "sea"];

export class HeuristicBot implements BotPlayer {
  async selectAction(view: ALSView): Promise<ALSAction> {
    return pickAction(view);
  }
}

function pickAction(view: ALSView): ALSAction {
  const me = view.myPlayerId!;
  const opp: PlayerId = me === "player-0" ? "player-1" : "player-0";

  if (view.phase === "round-over") return { type: "start-next-round" };
  if (view.pendingAbility) return resolveAbility(view, me, opp);

  // Consider withdrawal
  if (shouldWithdraw(view, me, opp)) return { type: "withdraw" };

  // Try to play face-up to matching theater, prioritizing high strength
  const faceUpPlays = getFaceUpPlays(view, me, opp);
  if (faceUpPlays.length > 0) {
    // Pick the play with the best score
    faceUpPlays.sort((a, b) => b.score - a.score);
    return faceUpPlays[0].action;
  }

  // Play face-down: pick the lowest-strength card to the most contested theater
  return playFaceDown(view, me, opp);
}

interface ScoredAction {
  action: ALSAction;
  score: number;
}

function getFaceUpPlays(view: ALSView, me: PlayerId, opp: PlayerId): ScoredAction[] {
  const plays: ScoredAction[] = [];

  for (const cardId of view.myHand) {
    const card = getCard(cardId);

    // Which theaters can this card be played face-up to?
    const validTheaters: Theater[] = [];
    if (view.airDropActive) {
      validTheaters.push(...THEATERS);
    } else if (card.strength <= 3 && view.aerodromeActive) {
      validTheaters.push(...THEATERS);
    } else {
      validTheaters.push(card.theater);
    }

    for (const theater of validTheaters) {
      const myStr = view.theaterStrengths[theater]?.[me] ?? 0;
      const oppStr = view.theaterStrengths[theater]?.[opp] ?? 0;

      // Score: prefer playing where it helps win a theater
      let score = card.strength;

      // Bonus for theaters we're losing (try to catch up)
      if (myStr < oppStr) score += 3;
      // Bonus for theaters that are close (swing theaters)
      if (Math.abs(myStr - oppStr) <= 2) score += 2;
      // Bonus for abilities
      if (card.abilityType === "instant") score += 1;
      if (card.abilityType === "ongoing") score += 2;

      plays.push({
        action: { type: "play", cardId, theater, faceUp: true },
        score,
      });
    }
  }

  return plays;
}

function playFaceDown(view: ALSView, me: PlayerId, opp: PlayerId): ALSAction {
  // Pick lowest-strength card to play face-down
  const sorted = [...view.myHand].sort((a, b) => {
    return getCard(a).strength - getCard(b).strength;
  });

  const cardId = sorted[0] || view.myHand[0];

  // Play to the theater where we need the most help
  let bestTheater: Theater = "air";
  let bestDeficit = -Infinity;
  for (const theater of THEATERS) {
    const myStr = view.theaterStrengths[theater]?.[me] ?? 0;
    const oppStr = view.theaterStrengths[theater]?.[opp] ?? 0;
    const deficit = oppStr - myStr;
    if (deficit > bestDeficit) {
      bestDeficit = deficit;
      bestTheater = theater;
    }
  }

  return { type: "play", cardId, theater: bestTheater, faceUp: false };
}

function shouldWithdraw(view: ALSView, me: PlayerId, opp: PlayerId): boolean {
  const cardsLeft = view.myHand.length;
  if (cardsLeft >= 5) return false; // too early

  // Count theaters we're winning
  let winning = 0;
  let losing = 0;
  for (const theater of THEATERS) {
    const myStr = view.theaterStrengths[theater]?.[me] ?? 0;
    const oppStr = view.theaterStrengths[theater]?.[opp] ?? 0;
    if (myStr > oppStr) winning++;
    else if (oppStr > myStr) losing++;
  }

  // Withdraw if losing 2+ theaters and few cards left
  if (losing >= 2 && cardsLeft <= 3) return true;
  // Withdraw if losing all 3 theaters
  if (losing >= 3) return true;

  return false;
}

function resolveAbility(view: ALSView, me: PlayerId, opp: PlayerId): ALSAction {
  const pending = view.pendingAbility!;

  switch (pending.type) {
    case "maneuver": {
      // Flip opponent's top card if possible (flip face-up to face-down)
      for (const theater of (pending as any).adjacentTheaters as Theater[]) {
        const oppStack = view.theaters[theater].stacks[opp];
        if (oppStack.length > 0) {
          const top = oppStack[oppStack.length - 1];
          if (top.faceUp) {
            return { type: "choose-flip", theater, cardOwner: opp, cardIndex: oppStack.length - 1 };
          }
        }
      }
      // Flip own face-down card to face-up
      for (const theater of (pending as any).adjacentTheaters as Theater[]) {
        const myStack = view.theaters[theater].stacks[me];
        if (myStack.length > 0) {
          return { type: "choose-flip", theater, cardOwner: me, cardIndex: myStack.length - 1 };
        }
        const oppStack = view.theaters[theater].stacks[opp];
        if (oppStack.length > 0) {
          return { type: "choose-flip", theater, cardOwner: opp, cardIndex: oppStack.length - 1 };
        }
      }
      break;
    }

    case "ambush": {
      // Flip opponent's strongest face-up card
      let best: { theater: Theater; index: number; strength: number } | null = null;
      for (const theater of THEATERS) {
        const oppStack = view.theaters[theater].stacks[opp];
        if (oppStack.length > 0) {
          const top = oppStack[oppStack.length - 1];
          if (top.faceUp && top.cardId) {
            const str = getCard(top.cardId).strength;
            if (!best || str > best.strength) {
              best = { theater, index: oppStack.length - 1, strength: str };
            }
          }
        }
      }
      if (best) {
        return { type: "choose-flip", theater: best.theater, cardOwner: opp, cardIndex: best.index };
      }
      // Fallback: flip any card
      for (const theater of THEATERS) {
        for (const owner of [opp, me] as PlayerId[]) {
          const stack = view.theaters[theater].stacks[owner];
          if (stack.length > 0) {
            return { type: "choose-flip", theater, cardOwner: owner, cardIndex: stack.length - 1 };
          }
        }
      }
      break;
    }

    case "transport": {
      // Move a card from a theater we're dominating to one we're losing
      let worstTheater: Theater = "air";
      let worstDeficit = -Infinity;
      let bestSource: { theater: Theater; index: number } | null = null;

      for (const theater of THEATERS) {
        const deficit = (view.theaterStrengths[theater]?.[opp] ?? 0) - (view.theaterStrengths[theater]?.[me] ?? 0);
        if (deficit > worstDeficit) {
          worstDeficit = deficit;
          worstTheater = theater;
        }
      }

      for (const theater of THEATERS) {
        if (theater === worstTheater) continue;
        const stack = view.theaters[theater].stacks[me];
        if (stack.length > 0) {
          bestSource = { theater, index: stack.length - 1 };
          break;
        }
      }

      if (bestSource) {
        return { type: "choose-transport", fromTheater: bestSource.theater, cardIndex: bestSource.index, toTheater: worstTheater };
      }
      // Fallback
      for (const theater of THEATERS) {
        const stack = view.theaters[theater].stacks[me];
        if (stack.length > 0) {
          const to = THEATERS.find(t => t !== theater)!;
          return { type: "choose-transport", fromTheater: theater, cardIndex: 0, toTheater: to };
        }
      }
      break;
    }

    case "reinforce": {
      // Play if we have adjacent theaters we're losing
      const adj = (pending as any).adjacentTheaters as Theater[];
      for (const theater of adj) {
        const myStr = view.theaterStrengths[theater]?.[me] ?? 0;
        const oppStr = view.theaterStrengths[theater]?.[opp] ?? 0;
        if (oppStr >= myStr) {
          return { type: "choose-reinforce", play: true, theater };
        }
      }
      // Otherwise play to first adjacent
      if (adj.length > 0) return { type: "choose-reinforce", play: true, theater: adj[0] };
      return { type: "choose-reinforce", play: false };
    }

    case "redeploy": {
      // Pick up a face-down card (get it back to hand for a better play)
      for (const theater of THEATERS) {
        const stack = view.theaters[theater].stacks[me];
        for (let i = 0; i < stack.length; i++) {
          if (!stack[i].faceUp) {
            return { type: "choose-redeploy", theater, cardIndex: i };
          }
        }
      }
      break;
    }

    case "disrupt-opponent":
    case "disrupt-self": {
      // Flip our weakest face-up card face-down, or our strongest face-down card face-up
      for (const theater of THEATERS) {
        const stack = view.theaters[theater].stacks[me];
        if (stack.length > 0) {
          return { type: "choose-disrupt-flip", theater, cardIndex: stack.length - 1 };
        }
      }
      break;
    }
  }

  // Should not reach here, but fallback to withdraw
  return { type: "withdraw" };
}
