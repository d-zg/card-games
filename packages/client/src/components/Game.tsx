import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getRoom, startGame } from "../api.js";
import { useIdentity } from "../hooks/useIdentity.js";
import { useGameSocket } from "../hooks/useGameSocket.js";
import { AirLandSeaBoard } from "../games/air-land-sea/Board.js";
import type { ALSView } from "@card-games/shared/src/games/air-land-sea/types.js";
import type { PlayerId } from "@card-games/shared";

export function Game() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const { token } = useIdentity(roomId!);
  const [gameId, setGameId] = useState<string | null>(null);
  const [playerNames, setPlayerNames] = useState<Record<PlayerId, string>>({});
  const [playerWins, setPlayerWins] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const fetchRoom = useCallback(async () => {
    if (!roomId) return;
    try {
      const room = await getRoom(roomId);
      if (room.gameId) {
        setGameId(room.gameId);
        const names: Record<string, string> = {};
        for (const p of room.players) {
          names[p.playerId] = p.displayName;
        }
        setPlayerNames(names);
        setPlayerWins(room.wins ?? {});
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }
  }, [roomId]);

  // Fetch gameId and player names on mount
  useEffect(() => {
    fetchRoom();
  }, [fetchRoom]);

  const { view, version, connected, error, sendAction } = useGameSocket<ALSView>(gameId, token);

  // When game is over, poll for a new gameId (the other player may have started a new game)
  useEffect(() => {
    if (view?.phase !== "game-over") return;

    const interval = setInterval(async () => {
      if (!roomId) return;
      try {
        const room = await getRoom(roomId);
        if (room.gameId && room.gameId !== gameId) {
          setGameId(room.gameId);
        }
      } catch {
        // ignore
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [view?.phase, roomId, gameId]);

  const handlePlayAgain = async () => {
    if (!roomId || !token) return;
    try {
      const { gameId: newGameId } = await startGame(roomId, token);
      setGameId(newGameId);
      // Re-fetch room to get updated wins
      await fetchRoom();
    } catch (e) {
      // If the other player already started, fetch the new game
      await fetchRoom();
    }
  };

  if (loading) return <div style={{ padding: 40, fontFamily: "system-ui" }}>Loading...</div>;
  if (!gameId) return <div style={{ padding: 40, fontFamily: "system-ui" }}>No game found for this room.</div>;

  return (
    <div style={{ fontFamily: "system-ui" }}>
      <div style={{ padding: "8px 16px" }}>
        <button
          onClick={() => navigate("/")}
          style={{ background: "none", border: "none", color: "#1976d2", cursor: "pointer", fontSize: 14, padding: 0 }}
        >
          ← Home
        </button>
      </div>
      {!connected && (
        <div style={{ background: "#fff3cd", padding: 8, textAlign: "center", fontSize: 14 }}>
          Reconnecting...
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
          version={version}
          playerNames={playerNames}
          playerWins={playerWins}
          onAction={sendAction}
          onPlayAgain={handlePlayAgain}
        />
      ) : (
        <div style={{ padding: 40, textAlign: "center" }}>Loading game...</div>
      )}
    </div>
  );
}
