import { Router } from "express";
import type { Db } from "../db.js";
import type { GameManager } from "../game-manager.js";

export function createRoomRoutes(db: Db, manager: GameManager): Router {
  const router = Router();
  const knownGameTypes = new Set(manager.getGameTypes());

  // Create a room
  router.post("/", (req, res) => {
    const { gameType } = req.body;
    if (!gameType || !knownGameTypes.has(gameType)) {
      res.status(400).json({ error: "Invalid or missing gameType" });
      return;
    }

    const roomId = db.createRoom(gameType);
    res.status(201).json({ roomId });
  });

  // Get room info
  router.get("/:roomId", (req, res) => {
    const room = db.getRoom(req.params.roomId);
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }

    const players = db.getPlayersByRoom(room.id).map((p) => ({
      playerId: p.playerId,
      displayName: p.displayName,
    }));

    res.json({
      id: room.id,
      gameType: room.gameType,
      status: room.status,
      gameId: room.gameId,
      players,
      wins: room.wins,
    });
  });

  // Join a seat
  router.post("/:roomId/join", (req, res) => {
    const room = db.getRoom(req.params.roomId);
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }

    if (room.status !== "waiting") {
      res.status(400).json({ error: "Room is not accepting players" });
      return;
    }

    const meta = manager.getGameMeta(room.gameType);
    const currentPlayers = db.getPlayersByRoom(room.id);
    if (meta && currentPlayers.length >= meta.maxPlayers) {
      res.status(400).json({ error: "Room is full" });
      return;
    }

    const { playerId, displayName } = req.body;
    if (!playerId || !displayName) {
      res.status(400).json({ error: "Missing playerId or displayName" });
      return;
    }

    try {
      const token = db.createPlayer(room.id, playerId, displayName);
      res.json({ token });
    } catch {
      res.status(409).json({ error: "Seat is already taken" });
    }
  });

  // Leave a seat
  router.post("/:roomId/leave", (req, res) => {
    const player = getPlayerFromAuth(db, req);
    if (!player) {
      res.status(401).json({ error: "Invalid or missing token" });
      return;
    }

    if (player.roomId !== req.params.roomId) {
      res.status(403).json({ error: "Token does not belong to this room" });
      return;
    }

    const room = db.getRoom(player.roomId);
    if (room && room.status !== "waiting") {
      res.status(400).json({ error: "Cannot leave while game is in progress" });
      return;
    }

    db.removePlayer(player.token);
    res.json({ ok: true });
  });

  // Start the game
  router.post("/:roomId/start", (req, res) => {
    const player = getPlayerFromAuth(db, req);
    if (!player) {
      res.status(401).json({ error: "Invalid or missing token" });
      return;
    }

    if (player.roomId !== req.params.roomId) {
      res.status(403).json({ error: "Token does not belong to this room" });
      return;
    }

    const room = db.getRoom(req.params.roomId);
    if (!room) {
      res.status(404).json({ error: "Room not found" });
      return;
    }

    if (room.status === "playing" && room.gameId) {
      // Allow restart if the current game is finished
      const winners = manager.getWinner(room.gameId);
      if (winners === null) {
        res.status(400).json({ error: "Game is still in progress" });
        return;
      }
      // Record the win before starting a new game
      for (const winner of winners) {
        db.recordWin(room.id, winner);
      }
    } else if (room.status !== "waiting") {
      res.status(400).json({ error: "Game already started" });
      return;
    }

    const players = db.getPlayersByRoom(room.id);
    const startMeta = manager.getGameMeta(room.gameType);
    if (startMeta && players.length < startMeta.minPlayers) {
      res.status(400).json({ error: "Not enough players" });
      return;
    }

    const gameId = manager.createGame(room.id, room.gameType, players.length);
    db.updateRoom(room.id, { status: "playing", gameId });

    res.json({ gameId });
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
