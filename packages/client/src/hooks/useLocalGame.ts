/**
 * React hook for local human-vs-bot games.
 * Thin wrapper around LocalGameController.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { ALSView, ALSAction } from "@card-games/shared/src/games/air-land-sea/types.js";
import type { PlayerId } from "@card-games/shared";
import {
  LocalGameController,
  type LocalGameState,
  type BotPlayer,
} from "@card-games/shared/src/games/air-land-sea/local-game-controller.js";

export interface UseLocalGameResult {
  view: ALSView | null;
  isHumanTurn: boolean;
  isGameOver: boolean;
  isRoundOver: boolean;
  winner: PlayerId | null;
  botThinking: boolean;
  sendAction: (action: ALSAction) => void;
  startNextRound: () => void;
  playAgain: () => void;
  error: string | null;
}

export function useLocalGame(
  bot: BotPlayer | null,
  humanPlayerId: PlayerId = "player-0",
): UseLocalGameResult {
  const [state, setState] = useState<LocalGameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const controllerRef = useRef<LocalGameController | null>(null);

  useEffect(() => {
    if (!bot) return;

    const controller = new LocalGameController({
      humanPlayerId,
      bot,
      onStateChange: setState,
      seed,
    });
    controllerRef.current = controller;

    controller.start().catch((e) => setError(e.message));

    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [bot, humanPlayerId, seed]);

  const sendAction = useCallback((action: ALSAction) => {
    const controller = controllerRef.current;
    if (!controller) return;
    setError(null);
    controller.submitAction(action).then((result) => {
      if (result.error) setError(result.error);
    });
  }, []);

  const startNextRound = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.startNextRound();
  }, []);

  const playAgain = useCallback(() => {
    setSeed(Math.floor(Math.random() * 1e9));
    setError(null);
  }, []);

  return {
    view: state?.view ?? null,
    isHumanTurn: state?.isHumanTurn ?? false,
    isGameOver: state?.isGameOver ?? false,
    isRoundOver: state?.isRoundOver ?? false,
    winner: state?.winner ?? null,
    botThinking: state?.botThinking ?? false,
    sendAction,
    startNextRound,
    playAgain,
    error,
  };
}
