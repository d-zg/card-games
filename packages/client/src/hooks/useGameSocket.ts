import { useState, useEffect, useRef, useCallback } from "react";

interface GameSocketState<TView> {
  view: TView | null;
  version: number;
  connected: boolean;
  error: string | null;
}

interface UseGameSocketResult<TView> extends GameSocketState<TView> {
  sendAction: (action: unknown) => void;
}

const MAX_BACKOFF = 30000;
const INITIAL_BACKOFF = 1000;

export function useGameSocket<TView>(
  gameId: string | null,
  token: string | null,
): UseGameSocketResult<TView> {
  const [state, setState] = useState<GameSocketState<TView>>({
    view: null,
    version: -1,
    connected: false,
    error: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gameIdRef = useRef(gameId);
  const tokenRef = useRef(token);

  // Keep refs in sync so callbacks don't go stale
  gameIdRef.current = gameId;
  tokenRef.current = token;

  const connect = useCallback(() => {
    if (!gameIdRef.current) return;

    // Clean up any existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = tokenRef.current
      ? `${protocol}//${window.location.host}/ws?token=${tokenRef.current}`
      : `${protocol}//${window.location.host}/ws`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      backoffRef.current = INITIAL_BACKOFF;
      setState((prev) => ({ ...prev, connected: true, error: null }));

      // Subscribe to the game
      ws.send(JSON.stringify({ type: "subscribe", gameId: gameIdRef.current }));
    };

    ws.onmessage = (event) => {
      let msg: { type: string; view?: TView; version?: number; message?: string };
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === "state" && msg.view !== undefined && msg.version !== undefined) {
        setState((prev) => {
          // Only accept newer versions
          if (msg.version! <= prev.version) return prev;
          return { ...prev, view: msg.view!, version: msg.version! };
        });
      } else if (msg.type === "error") {
        setState((prev) => ({ ...prev, error: msg.message ?? "Unknown error" }));
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      setState((prev) => ({ ...prev, connected: false }));

      // Reconnect with exponential backoff
      const delay = backoffRef.current;
      backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF);
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      // onclose will fire after this, which handles reconnection
    };
  }, []);

  // Connect when gameId changes
  useEffect(() => {
    if (!gameId) return;

    // Reset state for new game
    setState({ view: null, version: -1, connected: false, error: null });
    connect();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [gameId, token, connect]);

  // Re-subscribe on tab visibility change (mobile wake)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && wsRef.current?.readyState === WebSocket.OPEN && gameIdRef.current) {
        wsRef.current.send(JSON.stringify({ type: "subscribe", gameId: gameIdRef.current }));
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  const sendAction = useCallback((action: unknown) => {
    // Submit via REST, not WebSocket — the WS broadcast will update state
    if (!gameIdRef.current || !tokenRef.current) return;

    fetch(`/api/games/${gameIdRef.current}/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenRef.current}`,
      },
      body: JSON.stringify(action),
    }).catch(() => {
      setState((prev) => ({ ...prev, error: "Failed to send action" }));
    });
  }, []);

  return {
    ...state,
    sendAction,
  };
}
