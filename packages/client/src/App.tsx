import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Home } from "./components/Home.js";
import { Lobby } from "./components/Lobby.js";
import { Game } from "./components/Game.js";
import { BotGame } from "./components/BotGame.js";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/play/bot" element={<BotGame />} />
        <Route path="/room/:roomId" element={<Lobby />} />
        <Route path="/room/:roomId/play" element={<Game />} />
      </Routes>
    </BrowserRouter>
  );
}
