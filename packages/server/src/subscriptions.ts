export interface Connection {
  id: string;
  playerId: string | null;
  send: (msg: unknown) => void;
}

export interface Subscriptions {
  subscribe(gameId: string, conn: Connection): void;
  unsubscribe(connectionId: string): void;
  getSubscribers(gameId: string): Connection[];
  broadcast(
    gameId: string,
    getView: (playerId: string) => unknown,
    getSpectatorView: () => unknown,
    version: number,
  ): void;
}

export function createSubscriptions(): Subscriptions {
  // gameId → list of connections
  const byGame = new Map<string, Connection[]>();
  // connectionId → set of gameIds (for cleanup on disconnect)
  const byConnection = new Map<string, Set<string>>();

  return {
    subscribe(gameId: string, conn: Connection): void {
      let conns = byGame.get(gameId);
      if (!conns) {
        conns = [];
        byGame.set(gameId, conns);
      }
      const existing = conns.findIndex((c) => c.id === conn.id);
      if (existing !== -1) {
        conns[existing] = conn;
      } else {
        conns.push(conn);
      }

      let gameIds = byConnection.get(conn.id);
      if (!gameIds) {
        gameIds = new Set();
        byConnection.set(conn.id, gameIds);
      }
      gameIds.add(gameId);
    },

    unsubscribe(connectionId: string): void {
      const gameIds = byConnection.get(connectionId);
      if (!gameIds) return;

      for (const gameId of gameIds) {
        const conns = byGame.get(gameId);
        if (conns) {
          const filtered = conns.filter((c) => c.id !== connectionId);
          if (filtered.length === 0) {
            byGame.delete(gameId);
          } else {
            byGame.set(gameId, filtered);
          }
        }
      }

      byConnection.delete(connectionId);
    },

    getSubscribers(gameId: string): Connection[] {
      return byGame.get(gameId) ?? [];
    },

    broadcast(
      gameId: string,
      getView: (playerId: string) => unknown,
      getSpectatorView: () => unknown,
      version: number,
    ): void {
      const conns = byGame.get(gameId);
      if (!conns) return;

      for (const conn of conns) {
        try {
          const view = conn.playerId
            ? getView(conn.playerId)
            : getSpectatorView();

          conn.send({ type: "state", gameId, view, version });
        } catch {
          // Don't let one bad connection break broadcast to others
        }
      }
    },
  };
}
