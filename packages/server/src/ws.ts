import { WebSocketServer, type WebSocket } from "ws";
import type { Server } from "http";
import type { Db } from "./db.js";
import type { GameManager } from "./game-manager.js";
import { createSubscriptions } from "./subscriptions.js";
import { nanoid } from "nanoid";

export function attachWebSocket(
  server: Server,
  db: Db,
  manager: GameManager,
): void {
  const subs = createSubscriptions();
  const wss = new WebSocketServer({ server });

  // When a game action happens, broadcast updated views to all subscribers
  manager.onAction((gameId) => {
    subs.broadcast(
      gameId,
      (playerId) => manager.getView(gameId, playerId),
      () => manager.getSpectatorView(gameId),
      manager.getVersion(gameId),
    );
  });

  wss.on("connection", (ws, req) => {
    const connId = nanoid();

    // Resolve player from token in query string
    const url = new URL(req.url ?? "/", "http://localhost");
    const token = url.searchParams.get("token");
    const player = token ? db.getPlayerByToken(token) : null;

    ws.on("message", (data) => {
      let msg: { type: string; gameId?: string };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        sendJson(ws, { type: "error", message: "Invalid JSON" });
        return;
      }

      if (msg.type === "subscribe" && msg.gameId) {
        // Verify game exists
        let version: number;
        try {
          version = manager.getVersion(msg.gameId);
        } catch {
          sendJson(ws, { type: "error", message: "Game not found" });
          return;
        }

        subs.subscribe(msg.gameId, {
          id: connId,
          playerId: player?.playerId ?? null,
          send: (m) => sendJson(ws, m),
        });

        // Send current state immediately so the client doesn't have to REST fetch
        try {
          const view = player
            ? manager.getView(msg.gameId, player.playerId)
            : manager.getSpectatorView(msg.gameId);
          sendJson(ws, { type: "state", gameId: msg.gameId, view, version });
        } catch {
          // If view fails, the subscription is still active for future broadcasts
        }
      }
    });

    ws.on("close", () => {
      subs.unsubscribe(connId);
    });

    ws.on("error", () => {
      // Prevent unhandled error warnings on transport failures
    });
  });
}

function sendJson(ws: WebSocket, data: unknown): void {
  try {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(data));
    }
  } catch {
    // Socket closed between readyState check and send, or stringify failed
  }
}
