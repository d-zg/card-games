import { Router } from "express";
import type { Db } from "../db.js";
import type { GameManager } from "../game-manager.js";
import { InvalidActionError } from "@card-games/shared";

export function createGameRoutes(db: Db, manager: GameManager): Router {
  const router = Router();

  // Get game state (player view or spectator view)
  router.get("/:gameId/state", (req, res) => {
    const { gameId } = req.params;

    try {
      manager.getVersion(gameId); // throws if game doesn't exist
    } catch {
      res.status(404).json({ error: "Game not found" });
      return;
    }

    const version = manager.getVersion(gameId);
    const player = getPlayerFromAuth(db, req);
    if (player) {
      res.json({ view: manager.getView(gameId, player.playerId), version });
    } else {
      res.json({ view: manager.getSpectatorView(gameId), version });
    }
  });

  // Submit an action
  router.post("/:gameId/action", (req, res) => {
    const { gameId } = req.params;

    const player = getPlayerFromAuth(db, req);
    if (!player) {
      res.status(401).json({ error: "Invalid or missing token" });
      return;
    }

    try {
      manager.applyAction(gameId, player.playerId, req.body);
      const version = manager.getVersion(gameId);
      res.json({ view: manager.getView(gameId, player.playerId), version });
    } catch (err) {
      if (err instanceof InvalidActionError) {
        res.status(400).json({ error: err.message });
      } else if (
        err instanceof Error &&
        err.message.includes("not found")
      ) {
        res.status(404).json({ error: "Game not found" });
      } else if (err instanceof Error) {
        res.status(400).json({ error: err.message });
      } else {
        res.status(400).json({ error: "Invalid request" });
      }
    }
  });

  return router;
}

function getPlayerFromAuth(
  db: Db,
  req: { headers: { authorization?: string } },
) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  return db.getPlayerByToken(token);
}
