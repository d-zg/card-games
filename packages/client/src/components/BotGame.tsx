/**
 * Play against a bot locally — no server needed.
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AirLandSeaBoard } from "../games/air-land-sea/Board.js";
import { useLocalGame } from "../hooks/useLocalGame.js";
import { BrowserBot, initJax } from "../games/air-land-sea/BrowserBot.js";
import type { BotPlayer } from "@card-games/shared/src/games/air-land-sea/local-game-controller.js";

const MODEL_PATH = "/models";

const MODELS = [
  { id: "large-2m-gae-batch200", label: "Strong (GAE trained)" },
  { id: "large-2m-batch200", label: "Large (2M params)" },
  { id: "small-126k-batch200", label: "Small (126k params)" },
] as const;

export function BotGame() {
  const navigate = useNavigate();
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id);
  const [bot, setBot] = useState<BotPlayer | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wins, setWins] = useState({ human: 0, bot: 0 });
  const [jaxReady, setJaxReady] = useState(false);

  // Initialize jax-js once
  useEffect(() => {
    let cancelled = false;
    initJax().then(() => {
      if (!cancelled) setJaxReady(true);
    }).catch((e) => {
      if (!cancelled) { setLoadError(e.message); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, []);

  // Load model when jax is ready or selection changes
  useEffect(() => {
    if (!jaxReady) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setBot(null);

    BrowserBot.load(MODEL_PATH, selectedModel).then((loadedBot) => {
      if (!cancelled) {
        setBot(loadedBot);
        setLoading(false);
      }
    }).catch((e) => {
      if (!cancelled) {
        setLoadError(e.message);
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [jaxReady, selectedModel]);

  const { view, isHumanTurn, isGameOver, isRoundOver, winner, botThinking, sendAction, startNextRound, playAgain, error } = useLocalGame(bot);

  const handlePlayAgain = () => {
    if (winner) {
      setWins((prev) => ({
        human: prev.human + (winner === "player-0" ? 1 : 0),
        bot: prev.bot + (winner === "player-1" ? 1 : 0),
      }));
    }
    playAgain();
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedModel(e.target.value);
    setWins({ human: 0, bot: 0 });
  };

  if (loading) {
    return (
      <div style={{ padding: 40, fontFamily: "system-ui", textAlign: "center" }}>
        <p>Loading AI model...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ padding: 40, fontFamily: "system-ui", textAlign: "center" }}>
        <p>Failed to load AI: {loadError}</p>
        <button onClick={() => navigate("/")}>Back to Home</button>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "system-ui" }}>
      <div style={{ padding: "8px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button
          onClick={() => navigate("/")}
          style={{ background: "none", border: "none", color: "#1976d2", cursor: "pointer", fontSize: 14, padding: 0 }}
        >
          ← Home
        </button>
        <select
          value={selectedModel}
          onChange={handleModelChange}
          style={{ fontSize: 13, padding: "2px 4px" }}
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <span style={{ fontSize: 13, color: "#666" }}>
          You: {wins.human} | Bot: {wins.bot}
        </span>
      </div>

      {botThinking && (
        <div style={{ background: "#e3f2fd", padding: 6, textAlign: "center", fontSize: 13 }}>
          Bot is thinking...
        </div>
      )}

      {isRoundOver && !isGameOver && (
        <div style={{ background: "#e8f5e9", padding: 12, textAlign: "center" }}>
          <span style={{ fontSize: 14, marginRight: 12 }}>Round over!</span>
          <button onClick={startNextRound} style={{ padding: "6px 16px", fontSize: 14 }}>
            Next Round
          </button>
        </div>
      )}

      {error && (
        <div style={{ background: "#f8d7da", padding: 8, textAlign: "center", fontSize: 14 }}>
          {error}
        </div>
      )}

      {view ? (
        <AirLandSeaBoard
          view={view}
          version={0}
          playerNames={{ "player-0": "You", "player-1": "Bot" }}
          playerWins={{ "player-0": wins.human, "player-1": wins.bot }}
          onAction={sendAction}
          onPlayAgain={handlePlayAgain}
        />
      ) : (
        <div style={{ padding: 40, textAlign: "center" }}>Starting game...</div>
      )}
    </div>
  );
}
