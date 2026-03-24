import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Home } from "./components/Home.js";
import { Lobby } from "./components/Lobby.js";
import { Game } from "./components/Game.js";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room/:roomId" element={<Lobby />} />
        <Route path="/room/:roomId/play" element={<Game />} />
      </Routes>
    </BrowserRouter>
  );
}
