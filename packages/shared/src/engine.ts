import type { PlayerId, GameMeta } from "./types.js";
import type { SeededRng } from "./random.js";

export interface GameDefinition<TState, TAction, TView> {
  meta: GameMeta;

  /** Create the initial game state for a given number of players. */
  setup(playerCount: number, rng: SeededRng): TState;

  /**
   * Apply an action to the state, returning the new state.
   * Assumes the action has already been validated.
   */
  reducer(
    state: TState,
    action: TAction,
    playerId: PlayerId,
    rng: SeededRng,
  ): TState;

  /** Return the view of the game state for a specific player. */
  view(state: TState, playerId: PlayerId): TView;

  /** Return the view for spectators (no hidden information). */
  spectatorView(state: TState): TView;

  /**
   * Validate whether an action is legal for a player in the current state.
   * Returns null if valid, or an error message string if invalid.
   */
  validateAction(
    state: TState,
    action: TAction,
    playerId: PlayerId,
  ): string | null;

  /** Returns the winner(s), or null if the game is still ongoing. */
  getWinner(state: TState): PlayerId[] | null;

  /** Which player(s) need to act right now. Empty = game over. */
  activePlayerIds(state: TState): PlayerId[];
}
