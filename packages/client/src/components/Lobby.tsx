import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getRoom, joinRoom, startGame } from "../api.js";
import { useIdentity } from "../hooks/useIdentity.js";
import type { GetRoomResponse } from "@card-games/shared";

const SEATS = ["player-0", "player-1"];

export function Lobby() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const { token, save } = useIdentity(roomId!);
  const [room, setRoom] = useState<GetRoomResponse | null>(null);
  const [name, setName] = useState("");
  const [mySeatId, setMySeatId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Poll room state
  useEffect(() => {
    if (!roomId) return;

    let active = true;
    const fetchRoom = async () => {
      try {
        const data = await getRoom(roomId);
        if (!active) return;

        // Auto-redirect when game starts (another player started it)
        if (data.status === "playing" && data.gameId) {
          navigate(`/room/${roomId}/play`, { replace: true });
          return;
        }

        setRoom(data);
        setLoading(false);
      } catch {
        if (active) {
          setError("Room not found");
          setLoading(false);
        }
      }
    };

    fetchRoom();
    const interval = setInterval(fetchRoom, 2000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [roomId]);

  const handleJoin = async (seatId: string) => {
    if (!roomId || !name.trim()) return;
    setError(null);
    try {
      const { token: newToken } = await joinRoom(roomId, seatId, name.trim());
      save(newToken);
      setMySeatId(seatId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to join");
    }
  };

  const handleStart = async () => {
    if (!roomId || !token) return;
    setError(null);
    try {
      const { gameId } = await startGame(roomId, token);
      navigate(`/room/${roomId}/play`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start game");
    }
  };

  if (loading) return <div style={{ padding: 40, fontFamily: "system-ui" }}>Loading...</div>;
  if (!room) return <div style={{ padding: 40, fontFamily: "system-ui" }}>Room not found</div>;

  const isSeated = !!token;
  const isWaiting = room.status === "waiting";
  const isPlaying = room.status === "playing";

  return (
    <div style={{ maxWidth: 500, margin: "40px auto", fontFamily: "system-ui" }}>
      <h1>Room: {roomId}</h1>
      <p style={{ color: "#666" }}>Game: {room.gameType}</p>

      <h2>Players</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
        {SEATS.map((seatId) => {
          const player = room.players.find((p) => p.playerId === seatId);
          const isMe = seatId === mySeatId;
          return (
            <div
              key={seatId}
              style={{
                padding: 12,
                border: "1px solid #ccc",
                borderRadius: 4,
                background: player ? (isMe ? "#e8f5e9" : "#f5f5f5") : "white",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <strong>{seatId}</strong>
                {player && <span style={{ marginLeft: 8 }}>{player.displayName}{isMe ? " (you)" : ""}</span>}
              </div>
              {!player && !isSeated && isWaiting && (
                <button onClick={() => handleJoin(seatId)} disabled={!name.trim()}>
                  Sit Here
                </button>
              )}
            </div>
          );
        })}
      </div>

      {!isSeated && isWaiting && (
        <div style={{ marginBottom: 24 }}>
          <input
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ padding: 8, fontSize: 16, width: "100%", boxSizing: "border-box" }}
          />
        </div>
      )}

      {isWaiting && isSeated && room.players.length >= 2 && (
        <button onClick={handleStart} style={{ width: "100%", padding: 12, fontSize: 16 }}>
          Start Game
        </button>
      )}

      {isWaiting && isSeated && room.players.length < 2 && (
        <p style={{ color: "#666" }}>Waiting for another player...</p>
      )}

      {isPlaying && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <button
            onClick={() => navigate(`/room/${roomId}/play`)}
            style={{ width: "100%", padding: 12, fontSize: 16 }}
          >
            Go to Game
          </button>
          {isSeated && (
            <button
              onClick={handleStart}
              style={{ width: "100%", padding: 12, fontSize: 16, background: "#e8f5e9", border: "1px solid #4caf50", borderRadius: 4 }}
            >
              Start New Game
            </button>
          )}
        </div>
      )}

      {error && <p style={{ color: "red" }}>{error}</p>}

      <p style={{ marginTop: 32, color: "#999", fontSize: 14 }}>
        Share this room code with a friend: <strong>{roomId}</strong>
      </p>
    </div>
  );
}
