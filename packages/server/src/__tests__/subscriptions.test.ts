/**
 * Tests for subscription management and broadcast logic.
 *
 * Pure unit tests — no WebSocket, no server, no game engine.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createSubscriptions, type Subscriptions } from "../subscriptions.js";

let subs: Subscriptions;

beforeEach(() => {
  subs = createSubscriptions();
});

describe("subscribe / unsubscribe", () => {
  it("tracks a subscriber for a game", () => {
    subs.subscribe("game-1", { id: "conn-1", playerId: "player-0", send: () => {} });

    expect(subs.getSubscribers("game-1")).toHaveLength(1);
    expect(subs.getSubscribers("game-1")[0].id).toBe("conn-1");
  });

  it("tracks multiple subscribers for a game", () => {
    subs.subscribe("game-1", { id: "conn-1", playerId: "player-0", send: () => {} });
    subs.subscribe("game-1", { id: "conn-2", playerId: "player-1", send: () => {} });

    expect(subs.getSubscribers("game-1")).toHaveLength(2);
  });

  it("tracks subscribers across different games independently", () => {
    subs.subscribe("game-1", { id: "conn-1", playerId: "player-0", send: () => {} });
    subs.subscribe("game-2", { id: "conn-2", playerId: "player-0", send: () => {} });

    expect(subs.getSubscribers("game-1")).toHaveLength(1);
    expect(subs.getSubscribers("game-2")).toHaveLength(1);
  });

  it("returns empty array for game with no subscribers", () => {
    expect(subs.getSubscribers("game-1")).toEqual([]);
  });

  it("removes a subscriber by connection ID", () => {
    subs.subscribe("game-1", { id: "conn-1", playerId: "player-0", send: () => {} });
    subs.subscribe("game-1", { id: "conn-2", playerId: "player-1", send: () => {} });

    subs.unsubscribe("conn-1");

    expect(subs.getSubscribers("game-1")).toHaveLength(1);
    expect(subs.getSubscribers("game-1")[0].id).toBe("conn-2");
  });

  it("unsubscribing a nonexistent connection is a no-op", () => {
    expect(() => subs.unsubscribe("nonexistent")).not.toThrow();
  });

  it("removes subscriber from all games on unsubscribe", () => {
    subs.subscribe("game-1", { id: "conn-1", playerId: "player-0", send: () => {} });
    subs.subscribe("game-2", { id: "conn-1", playerId: "player-0", send: () => {} });

    subs.unsubscribe("conn-1");

    expect(subs.getSubscribers("game-1")).toHaveLength(0);
    expect(subs.getSubscribers("game-2")).toHaveLength(0);
  });

  it("deduplicates when same connection subscribes to same game twice", () => {
    const sent: unknown[] = [];
    const send = (msg: unknown) => sent.push(msg);

    subs.subscribe("game-1", { id: "conn-1", playerId: "player-0", send });
    subs.subscribe("game-1", { id: "conn-1", playerId: "player-0", send });

    expect(subs.getSubscribers("game-1")).toHaveLength(1);

    subs.broadcast("game-1", () => ({ view: "p0" }), () => ({ view: "spectator" }), 1);
    expect(sent).toHaveLength(1);
  });

  it("allows spectator subscribers (null playerId)", () => {
    subs.subscribe("game-1", { id: "conn-1", playerId: null, send: () => {} });

    expect(subs.getSubscribers("game-1")).toHaveLength(1);
    expect(subs.getSubscribers("game-1")[0].playerId).toBeNull();
  });
});

describe("broadcast", () => {
  it("sends player views to player subscribers", () => {
    const sent: { id: string; msg: unknown }[] = [];

    subs.subscribe("game-1", {
      id: "conn-1",
      playerId: "player-0",
      send: (msg) => sent.push({ id: "conn-1", msg }),
    });
    subs.subscribe("game-1", {
      id: "conn-2",
      playerId: "player-1",
      send: (msg) => sent.push({ id: "conn-2", msg }),
    });

    subs.broadcast(
      "game-1",
      (playerId) => ({ hand: `${playerId}-hand` }),
      () => ({ hand: "spectator" }),
      5,
    );

    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual({
      id: "conn-1",
      msg: { type: "state", gameId: "game-1", view: { hand: "player-0-hand" }, version: 5 },
    });
    expect(sent[1]).toEqual({
      id: "conn-2",
      msg: { type: "state", gameId: "game-1", view: { hand: "player-1-hand" }, version: 5 },
    });
  });

  it("sends spectator view to subscribers with null playerId", () => {
    const sent: unknown[] = [];

    subs.subscribe("game-1", {
      id: "conn-1",
      playerId: null,
      send: (msg) => sent.push(msg),
    });

    subs.broadcast(
      "game-1",
      () => ({ hand: "player" }),
      () => ({ hand: "spectator" }),
      3,
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      type: "state",
      gameId: "game-1",
      view: { hand: "spectator" },
      version: 3,
    });
  });

  it("does nothing when no subscribers for the game", () => {
    // Should not throw
    subs.broadcast("game-1", () => ({}), () => ({}), 1);
  });

  it("does not send to subscribers of other games", () => {
    const sent: string[] = [];

    subs.subscribe("game-1", {
      id: "conn-1",
      playerId: "player-0",
      send: () => sent.push("game-1"),
    });
    subs.subscribe("game-2", {
      id: "conn-2",
      playerId: "player-0",
      send: () => sent.push("game-2"),
    });

    subs.broadcast("game-1", () => ({}), () => ({}), 1);

    expect(sent).toEqual(["game-1"]);
  });

  it("continues broadcasting to other connections when one send throws", () => {
    const sent: string[] = [];

    subs.subscribe("game-1", {
      id: "conn-1",
      playerId: "player-0",
      send: () => { throw new Error("socket dead"); },
    });
    subs.subscribe("game-1", {
      id: "conn-2",
      playerId: "player-1",
      send: () => sent.push("conn-2"),
    });

    subs.broadcast("game-1", () => ({}), () => ({}), 1);

    // conn-2 should still receive the broadcast despite conn-1 throwing
    expect(sent).toEqual(["conn-2"]);
  });

  it("includes version number in broadcast messages", () => {
    const sent: unknown[] = [];

    subs.subscribe("game-1", {
      id: "conn-1",
      playerId: "player-0",
      send: (msg) => sent.push(msg),
    });

    subs.broadcast("game-1", () => ({ data: "view" }), () => ({}), 42);

    expect(sent[0]).toEqual({
      type: "state",
      gameId: "game-1",
      view: { data: "view" },
      version: 42,
    });
  });
});
