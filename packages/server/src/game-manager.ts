import type { GameDefinition, PlayerId, GameRunner as GameRunnerType } from "@card-games/shared";
import { GameRunner } from "@card-games/shared";
import type { Db } from "./db.js";

export type ActionListener = (gameId: string) => void;

export interface GameManager {
  createGame(roomId: string, gameType: string, playerCount: number): string;
  applyAction(gameId: string, playerId: PlayerId, action: unknown): void;
  getView(gameId: string, playerId: PlayerId): unknown;
  getSpectatorView(gameId: string): unknown;
  getActivePlayerIds(gameId: string): PlayerId[];
  getWinner(gameId: string): PlayerId[] | null;
  getVersion(gameId: string): number;
  evict(gameId: string): void;
  onAction(listener: ActionListener): void;
  getGameTypes(): string[];
  getGameMeta(gameType: string): { minPlayers: number; maxPlayers: number } | null;
}

interface CachedGame {
  runner: GameRunnerType<unknown, unknown, unknown>;
  definition: GameDefinition<unknown, unknown, unknown>;
  baseSeed: number;
  playerCount: number;
}

export function createGameManager(
  db: Db,
  registry: Record<string, GameDefinition<unknown, unknown, unknown>>,
): GameManager {
  const cache = new Map<string, CachedGame>();
  const listeners: ActionListener[] = [];

  function getDefinition(gameType: string): GameDefinition<unknown, unknown, unknown> {
    const def = registry[gameType];
    if (!def) throw new Error(`Unknown game type: ${gameType}`);
    return def;
  }

  function loadGame(gameId: string): CachedGame {
    const cached = cache.get(gameId);
    if (cached) return cached;

    const game = db.getGame(gameId);
    if (!game) throw new Error(`Game not found: ${gameId}`);

    const definition = getDefinition(game.gameType);
    const actions = db.getActions(gameId);

    const runner = GameRunner.replay(
      definition,
      game.baseSeed,
      game.playerCount,
      actions.map((a) => ({
        playerId: a.playerId as PlayerId,
        action: a.action,
      })),
    );

    const entry: CachedGame = {
      runner,
      definition,
      baseSeed: game.baseSeed,
      playerCount: game.playerCount,
    };
    cache.set(gameId, entry);
    return entry;
  }

  return {
    createGame(roomId: string, gameType: string, playerCount: number): string {
      const definition = getDefinition(gameType);
      const baseSeed = Math.floor(Math.random() * 2 ** 31);
      const gameId = db.createGame(roomId, gameType, playerCount, baseSeed);

      const runner = new GameRunner(definition, baseSeed, playerCount);
      cache.set(gameId, { runner, definition, baseSeed, playerCount });

      return gameId;
    },

    applyAction(gameId: string, playerId: PlayerId, action: unknown): void {
      const game = loadGame(gameId);
      // This throws InvalidActionError if the action is invalid —
      // no DB write happens in that case.
      game.runner.applyAction(playerId, action as never);
      db.insertAction(gameId, game.runner.getVersion(), playerId, action);
      for (const listener of listeners) {
        try {
          listener(gameId);
        } catch {
          // Broadcast failures must not affect the action response
        }
      }
    },

    getView(gameId: string, playerId: PlayerId): unknown {
      return loadGame(gameId).runner.getView(playerId);
    },

    getSpectatorView(gameId: string): unknown {
      return loadGame(gameId).runner.getSpectatorView();
    },

    getActivePlayerIds(gameId: string): PlayerId[] {
      return loadGame(gameId).runner.getActivePlayerIds();
    },

    getWinner(gameId: string): PlayerId[] | null {
      return loadGame(gameId).runner.getWinner();
    },

    getVersion(gameId: string): number {
      return loadGame(gameId).runner.getVersion();
    },

    evict(gameId: string): void {
      cache.delete(gameId);
    },

    onAction(listener: ActionListener): void {
      listeners.push(listener);
    },

    getGameTypes(): string[] {
      return Object.keys(registry);
    },

    getGameMeta(gameType: string): { minPlayers: number; maxPlayers: number } | null {
      const def = registry[gameType];
      if (!def) return null;
      return { minPlayers: def.meta.minPlayers, maxPlayers: def.meta.maxPlayers };
    },
  };
}
