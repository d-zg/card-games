import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import type { Db } from "./db.js";
import type { GameManager } from "./game-manager.js";
import { createRoomRoutes } from "./routes/rooms.js";
import { createGameRoutes } from "./routes/games.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(db: Db, manager: GameManager): express.Express {
  const app = express();
  app.use(express.json());

  app.use("/api/rooms", createRoomRoutes(db, manager));
  app.use("/api/games", createGameRoutes(db, manager));

  // Serve client static files in production
  const clientDist = path.resolve(__dirname, "../../client/dist");
  app.use(express.static(clientDist));

  // SPA fallback — serve index.html for any non-API route
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });

  return app;
}
