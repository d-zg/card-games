import { createServer } from "http";
import { createDb } from "./db.js";
import { createGameManager } from "./game-manager.js";
import { createApp } from "./app.js";
import { attachWebSocket } from "./ws.js";
import { alsGame } from "@card-games/shared/src/games/air-land-sea/index.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const DB_PATH = process.env.DB_PATH ?? "card-games.db";

const db = createDb(DB_PATH);
const manager = createGameManager(db, { "air-land-sea": alsGame });
const app = createApp(db, manager);
const server = createServer(app);
attachWebSocket(server, db, manager);

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
