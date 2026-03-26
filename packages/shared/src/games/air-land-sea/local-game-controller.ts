/**
 * LocalGameController: manages a human-vs-bot game locally.
 *
 * Pure logic, no framework dependencies. Testable standalone.
 *
 * The controller wraps a GameRunner and orchestrates the turn flow:
 * - When it's the human's turn, it waits for submitAction()
 * - When it's the bot's turn, it calls the bot and advances automatically
 * - Round-over transitions are handled automatically
 * - State change callbacks notify the UI layer
 */

import type { PlayerId } from "../../types.js";
import type { ALSAction, ALSView } from "./types.js";
import { GameRunner } from "../../runner.js";
import { alsGame } from "./index.js";

/** A bot that can select an action given a game view. */
export interface BotPlayer {
  selectAction(view: ALSView): Promise<ALSAction>;
}

export interface LocalGameState {
  /** The human player's view of the game. */
  view: ALSView;
  /** Whether it's the human's turn to act. */
  isHumanTurn: boolean;
  /** Whether the game is over (someone reached 12 points). */
  isGameOver: boolean;
  /** Whether a round just ended (waiting to start next round). */
  isRoundOver: boolean;
  /** The winner, or null if game is still going. */
  winner: PlayerId | null;
  /** Whether the bot is currently "thinking." */
  botThinking: boolean;
}

export type StateChangeCallback = (state: LocalGameState) => void;

export class LocalGameController {
  private runner: GameRunner<any, ALSAction, ALSView>;
  private humanPlayerId: PlayerId;
  private botPlayerId: PlayerId;
  private bot: BotPlayer;
  private onStateChange: StateChangeCallback;
  private disposed = false;
  /** Snapshot of the view from just before the round ended, so the board stays visible. */
  private roundOverSnapshot: ALSView | null = null;

  constructor(options: {
    humanPlayerId: PlayerId;
    bot: BotPlayer;
    onStateChange: StateChangeCallback;
    seed?: number;
  }) {
    this.humanPlayerId = options.humanPlayerId;
    this.botPlayerId = options.humanPlayerId === "player-0" ? "player-1" : "player-0";
    this.bot = options.bot;
    this.onStateChange = options.onStateChange;
    this.runner = new GameRunner(alsGame, options.seed ?? Math.floor(Math.random() * 1e9), 2);
  }

  /** Start the game. Emits initial state and triggers bot if it goes first. */
  async start(): Promise<void> {
    this.emitState();
    await this.runBotTurns();
  }

  /** Human submits an action. Validates, applies, then runs any bot turns. */
  async submitAction(action: ALSAction): Promise<{ error?: string }> {
    if (this.disposed) return { error: "Game is disposed" };

    // Only allow actions when it's the human's turn
    const activeIds = this.runner.getActivePlayerIds();
    if (!activeIds.includes(this.humanPlayerId)) {
      return { error: "Not your turn" };
    }

    // Snapshot view before action (in case this action ends the round)
    this.captureSnapshot();

    // Validate and apply
    try {
      this.runner.applyAction(this.humanPlayerId, action);
    } catch (e: any) {
      return { error: e.message };
    }

    this.emitState();

    // Handle round-over and bot turns
    await this.runBotTurns();

    return {};
  }

  /** Start the next round after a round-over pause. */
  async startNextRound(): Promise<void> {
    if (this.disposed) return;
    const view = this.runner.getView(this.humanPlayerId);
    if (view.phase !== "round-over") return;

    this.roundOverSnapshot = null;
    this.runner.applyAction(this.humanPlayerId, { type: "start-next-round" });
    this.emitState();
    await this.runBotTurns();
  }

  /** Get the current state without triggering a callback. */
  getState(): LocalGameState {
    return this.buildState(false);
  }

  /** Clean up. */
  dispose(): void {
    this.disposed = true;
  }

  // -- Private --

  private buildState(botThinking: boolean): LocalGameState {
    const winner = this.runner.getWinner();
    const liveView = this.runner.getView(this.humanPlayerId);
    const activeIds = this.runner.getActivePlayerIds();
    const isRoundOver = liveView.phase === "round-over";

    // During round-over, use the snapshot so the board stays visible
    // but update scores and phase from the live view
    let view = liveView;
    if (isRoundOver && this.roundOverSnapshot) {
      view = {
        ...this.roundOverSnapshot,
        scores: liveView.scores,
        phase: liveView.phase,
        lastRoundWinner: liveView.lastRoundWinner,
        roundNumber: liveView.roundNumber,
        log: liveView.log,
      };
    }

    return {
      view,
      isHumanTurn: !botThinking && !isRoundOver && activeIds.includes(this.humanPlayerId) && !winner,
      isGameOver: winner !== null,
      isRoundOver,
      winner: winner ? winner[0] : null,
      botThinking,
    };
  }

  private emitState(botThinking = false): void {
    if (!this.disposed) {
      this.onStateChange(this.buildState(botThinking));
    }
  }

  /** Capture the current view as a snapshot (before an action that might end the round). */
  private captureSnapshot(): void {
    this.roundOverSnapshot = this.runner.getView(this.humanPlayerId);
  }

  /**
   * Run bot turns until it's the human's turn, the game is over,
   * or the game is in a state where neither player can act.
   */
  private async runBotTurns(): Promise<void> {
    while (!this.disposed) {
      const winner = this.runner.getWinner();
      if (winner) return;

      const view = this.runner.getView(this.humanPlayerId);

      // Pause at round-over — wait for human to call startNextRound()
      if (view.phase === "round-over") {
        this.emitState();
        return;
      }

      // Check whose turn it is
      const activeIds = this.runner.getActivePlayerIds();
      if (activeIds.length === 0) return;

      // If it's the human's turn, stop and wait
      if (activeIds.includes(this.humanPlayerId)) return;

      // It's the bot's turn
      if (!activeIds.includes(this.botPlayerId)) return;

      this.emitState(true); // botThinking = true

      const botView = this.runner.getView(this.botPlayerId);
      try {
        const action = await this.bot.selectAction(botView);
        if (this.disposed) return;
        this.captureSnapshot();
        this.runner.applyAction(this.botPlayerId, action);
      } catch (e: any) {
        // Bot error — skip turn (shouldn't happen with a trained model)
        console.error("Bot error:", e.message);
        return;
      }

      this.emitState();
    }
  }
}
