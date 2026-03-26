import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createRoom } from "../api.js";

export function Home() {
  const navigate = useNavigate();
  const [roomCode, setRoomCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const { roomId } = await createRoom("air-land-sea");
      navigate(`/room/${roomId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create room");
      setCreating(false);
    }
  };

  const handleJoinByCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomCode.trim()) {
      navigate(`/room/${roomCode.trim()}`);
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: "80px auto", fontFamily: "system-ui" }}>
      <h1>Air, Land &amp; Sea</h1>

      <button onClick={() => navigate("/play/bot")} style={{ width: "100%", padding: 12, fontSize: 16, marginBottom: 12 }}>
        Play vs Bot
      </button>

      <button onClick={handleCreate} disabled={creating} style={{ width: "100%", padding: 12, fontSize: 16, marginBottom: 24 }}>
        {creating ? "Creating..." : "Create Room"}
      </button>

      <form onSubmit={handleJoinByCode}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            placeholder="Enter room code"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value)}
            style={{ flex: 1, padding: 12, fontSize: 16 }}
          />
          <button type="submit" style={{ padding: 12, fontSize: 16 }}>
            Join
          </button>
        </div>
      </form>

      {error && <p style={{ color: "red", marginTop: 16 }}>{error}</p>}
    </div>
  );
}
