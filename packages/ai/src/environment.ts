/**
 * RL environment wrapper for Air, Land & Sea.
 *
 * Wraps GameRunner to provide a clean interface for self-play training:
 * reset(), step(), and trajectory collection.
 */

import { GameRunner } from "@card-games/shared";
import { fastAlsGame } from "./fast-engine.ts";
import type { ALSState, ALSAction, ALSView } from "@card-games/shared/games/air-land-sea/types.ts";
import type { PlayerId } from "@card-games/shared/types.ts";
import { encodeState, legalActionMask, decodeAction, encodeAction, STATE_SIZE, ACTION_SIZE } from "./encode.ts";

/** A single step recorded during a game. */
export interface Step {
  /** Encoded state from the acting player's perspective. */
  state: Float32Array;
  /** Legal action mask at this state. */
  legalMask: Float32Array;
  /** Action index that was taken. */
  actionIndex: number;
  /** Which player acted. */
  playerId: PlayerId;
}

/** A completed game trajectory with rewards assigned. */
export interface Trajectory {
  steps: Step[];
  /** +1 or -1 for each step, from the acting player's perspective. */
  rewards: Float32Array;
  /** The winner of the game. */
  winner: PlayerId;
}

export class Environment {
  private runner!: GameRunner<ALSState, ALSAction, ALSView>;
  private seed: number;
  private steps: Step[] = [];

  constructor(seed: number) {
    this.seed = seed;
    this.reset();
  }

  /** Start a new game, clearing any in-progress trajectory. */
  reset(): void {
    this.runner = new GameRunner(fastAlsGame, this.seed++, 2);
    this.steps = [];
  }

  /** Get the current active player, or null if the game is over. */
  activePlayer(): PlayerId | null {
    const ids = this.runner.getActivePlayerIds();
    return ids.length > 0 ? ids[0] : null;
  }

  /** Get the encoded state and legal action mask for the active player. */
  observe(): { state: Float32Array; legalMask: Float32Array; playerId: PlayerId } {
    const playerId = this.activePlayer()!;
    const view = this.runner.getView(playerId);
    return {
      state: encodeState(view),
      legalMask: legalActionMask(view),
      playerId,
    };
  }

  /**
   * Apply an action (by index) and record the step.
   * Accepts pre-computed state/mask from observe() to avoid double encoding.
   * Returns true if the game is over.
   */
  step(actionIndex: number, precomputed?: { state: Float32Array; legalMask: Float32Array }): boolean {
    const playerId = this.activePlayer()!;

    const state = precomputed?.state ?? encodeState(this.runner.getView(playerId));
    const legalMask = precomputed?.legalMask ?? legalActionMask(this.runner.getView(playerId));

    const action = decodeAction(actionIndex);
    if (!action) {
      throw new Error(`Invalid action index: ${actionIndex}`);
    }
    this.runner.applyAction(playerId, action);

    this.steps.push({ state, legalMask, actionIndex, playerId });

    // Handle round-over: auto-start next round (not a strategic decision)
    if (!this.isDone()) {
      const nextView = this.runner.getView("player-0");
      if (nextView.phase === "round-over") {
        this.runner.applyAction("player-0", { type: "start-next-round" });
      }
    }

    return this.isDone();
  }

  /** Get the completed trajectory after the game is over. */
  finish(): Trajectory {
    const winnerArr = this.runner.getWinner();
    if (!winnerArr) throw new Error("Game is not over");
    const winner = winnerArr[0];

    const rewards = new Float32Array(this.steps.length);
    for (let i = 0; i < this.steps.length; i++) {
      rewards[i] = this.steps[i].playerId === winner ? 1 : -1;
    }

    return { steps: this.steps, rewards, winner };
  }

  /** Is the game over? */
  isDone(): boolean {
    return this.runner.getWinner() !== null;
  }

  /**
   * Force-clear a pending ability that has no legal resolution.
   * Mutates the game state directly — only used for edge cases
   * where the game engine leaves an unresolvable ability pending.
   */
  forceSkipAbility(): void {
    const state = this.runner.getState() as ALSState;
    if (state.round?.pendingAbility) {
      state.round.pendingAbility = null;
    }
  }
}

/**
 * Play a complete game using an action-selection function.
 * Returns the trajectory.
 *
 * The selectAction function receives the encoded state and legal mask,
 * and returns an action index. This is where the policy network (or
 * random sampling) plugs in.
 */
export function playGame(
  seed: number,
  selectAction: (state: Float32Array, legalMask: Float32Array) => number,
): Trajectory {
  const env = new Environment(seed);

  while (!env.isDone()) {
    const { state, legalMask } = env.observe();
    // Rare edge case: an ability resolves to a state with no legal actions
    // (e.g., disrupt when the player has no cards to flip). Skip the turn.
    let hasLegal = false;
    for (let i = 0; i < legalMask.length; i++) {
      if (legalMask[i] > 0.5) { hasLegal = true; break; }
    }
    if (!hasLegal) {
      env.forceSkipAbility();
      continue;
    }
    const actionIndex = selectAction(state, legalMask);
    env.step(actionIndex);
  }

  return env.finish();
}

/** Select a random legal action (uniform). Useful as a baseline. */
export function randomAction(_state: Float32Array, legalMask: Float32Array): number {
  const legal: number[] = [];
  for (let i = 0; i < legalMask.length; i++) {
    if (legalMask[i] > 0.5) legal.push(i);
  }
  return legal[Math.floor(Math.random() * legal.length)];
}
