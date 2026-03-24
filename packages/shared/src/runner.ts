import type { PlayerId } from "./types.js";
import type { GameDefinition } from "./engine.js";
import { createRng } from "./random.js";

export interface ActionRecord {
  playerId: PlayerId;
  action: unknown;
  version: number;
}

export class GameRunner<TState, TAction, TView> {
  private state: TState;
  private version: number;
  private readonly actions: ActionRecord[] = [];

  constructor(
    private readonly definition: GameDefinition<TState, TAction, TView>,
    private readonly baseSeed: number,
    private readonly playerCount: number,
  ) {
    const { minPlayers, maxPlayers } = definition.meta;
    if (playerCount < minPlayers || playerCount > maxPlayers) {
      throw new Error(
        `Invalid player count ${playerCount} for ${definition.meta.name} (${minPlayers}-${maxPlayers})`,
      );
    }
    const rng = createRng(baseSeed);
    this.state = definition.setup(playerCount, rng);
    this.version = 0;
  }

  /** Apply a validated action, advancing the game state. */
  applyAction(playerId: PlayerId, action: TAction): void {
    const error = this.definition.validateAction(
      this.state,
      action,
      playerId,
    );
    if (error !== null) {
      throw new InvalidActionError(error);
    }

    this.version++;
    const rng = createRng(this.baseSeed + this.version);
    this.state = this.definition.reducer(this.state, action, playerId, rng);
    this.actions.push({
      playerId,
      action,
      version: this.version,
    });
  }

  /** Get the view for a specific player. */
  getView(playerId: PlayerId): TView {
    return this.definition.view(this.state, playerId);
  }

  /** Get the spectator view. */
  getSpectatorView(): TView {
    return this.definition.spectatorView(this.state);
  }

  /** Get the current winner(s), or null if game is ongoing. */
  getWinner(): PlayerId[] | null {
    return this.definition.getWinner(this.state);
  }

  /** Get which players need to act. */
  getActivePlayerIds(): PlayerId[] {
    return this.definition.activePlayerIds(this.state);
  }

  /** Get the full action log. */
  getActionLog(): readonly ActionRecord[] {
    return this.actions;
  }

  /** Get the current version (number of actions applied). */
  getVersion(): number {
    return this.version;
  }

  /** Get the current full state (for server-side use only). */
  getState(): TState {
    return this.state;
  }

  /**
   * Replay a game from a log of actions.
   * Returns a new GameRunner at the replayed state.
   */
  static replay<TState, TAction, TView>(
    definition: GameDefinition<TState, TAction, TView>,
    baseSeed: number,
    playerCount: number,
    actions: { playerId: PlayerId; action: TAction }[],
  ): GameRunner<TState, TAction, TView> {
    const runner = new GameRunner(definition, baseSeed, playerCount);
    for (const { playerId, action } of actions) {
      runner.applyAction(playerId, action);
    }
    return runner;
  }
}

export class InvalidActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidActionError";
  }
}
