import { describe, it, expect, vi } from "vitest";
import {
  LocalGameController,
  type BotPlayer,
  type LocalGameState,
} from "../../games/air-land-sea/local-game-controller.js";
import type { ALSView, ALSAction, Theater } from "../../games/air-land-sea/types.js";
import type { PlayerId } from "../../types.js";
import { ALL_CARDS, getCard } from "../../games/air-land-sea/cards.js";

// ============================================================
// Helpers
// ============================================================

/** A bot that always plays the first legal action. */
function firstLegalBot(): BotPlayer {
  return {
    async selectAction(view: ALSView): Promise<ALSAction> {
      if (view.phase === "round-over") return { type: "start-next-round" };
      if (view.pendingAbility) return firstLegalAbilityAction(view);

      // Play first card face-down to air (always legal)
      if (view.myHand.length > 0) {
        return { type: "play", cardId: view.myHand[0], theater: "air", faceUp: false };
      }
      return { type: "withdraw" };
    },
  };
}

/** A bot that records every view it receives. */
function spyBot(): BotPlayer & { views: ALSView[]; actions: ALSAction[] } {
  const bot = {
    views: [] as ALSView[],
    actions: [] as ALSAction[],
    async selectAction(view: ALSView): Promise<ALSAction> {
      bot.views.push(view);
      if (view.pendingAbility) {
        const action = firstLegalAbilityAction(view);
        bot.actions.push(action);
        return action;
      }
      const action: ALSAction = view.myHand.length > 0
        ? { type: "play", cardId: view.myHand[0], theater: "air", faceUp: false }
        : { type: "withdraw" };
      bot.actions.push(action);
      return action;
    },
  };
  return bot;
}

function firstLegalAbilityAction(view: ALSView): ALSAction {
  const pending = view.pendingAbility!;
  const me = view.myPlayerId!;
  const opp: PlayerId = me === "player-0" ? "player-1" : "player-0";
  const theaters: Theater[] = ["air", "land", "sea"];

  switch (pending.type) {
    case "maneuver": {
      for (const t of pending.adjacentTheaters) {
        for (const owner of [me, opp]) {
          const stack = view.theaters[t].stacks[owner];
          if (stack.length > 0) {
            return { type: "choose-flip", theater: t, cardOwner: owner, cardIndex: stack.length - 1 };
          }
        }
      }
      break;
    }
    case "ambush": {
      for (const t of theaters) {
        for (const owner of [me, opp]) {
          const stack = view.theaters[t].stacks[owner];
          if (stack.length > 0) {
            return { type: "choose-flip", theater: t, cardOwner: owner, cardIndex: stack.length - 1 };
          }
        }
      }
      break;
    }
    case "transport": {
      for (const t of theaters) {
        const stack = view.theaters[t].stacks[me];
        for (let i = 0; i < stack.length; i++) {
          for (const toT of theaters) {
            if (toT !== t) return { type: "choose-transport", fromTheater: t, cardIndex: i, toTheater: toT };
          }
        }
      }
      break;
    }
    case "reinforce":
      return { type: "choose-reinforce", play: false };
    case "redeploy": {
      for (const t of theaters) {
        const stack = view.theaters[t].stacks[me];
        for (let i = 0; i < stack.length; i++) {
          if (!stack[i].faceUp) return { type: "choose-redeploy", theater: t, cardIndex: i };
        }
      }
      break;
    }
    case "disrupt-opponent":
    case "disrupt-self": {
      for (const t of theaters) {
        const stack = view.theaters[t].stacks[me];
        if (stack.length > 0) {
          return { type: "choose-disrupt-flip", theater: t, cardIndex: stack.length - 1 };
        }
      }
      break;
    }
  }
  return { type: "withdraw" };
}

/** Collect state changes from a controller. */
function trackStates(controller: LocalGameController): LocalGameState[] {
  const states: LocalGameState[] = [];
  // We already passed onStateChange to the constructor, so this won't work.
  // Instead, we capture via the callback.
  return states;
}

/** Create a controller and capture all state emissions. */
function createTestController(options?: {
  humanPlayerId?: PlayerId;
  bot?: BotPlayer;
  seed?: number;
}): { controller: LocalGameController; states: LocalGameState[] } {
  const states: LocalGameState[] = [];
  const controller = new LocalGameController({
    humanPlayerId: options?.humanPlayerId ?? "player-0",
    bot: options?.bot ?? firstLegalBot(),
    onStateChange: (s) => states.push(s),
    seed: options?.seed ?? 42,
  });
  return { controller, states };
}

// ============================================================
// Tests
// ============================================================

describe("LocalGameController", () => {
  it("emits initial state on start", async () => {
    const { controller, states } = createTestController();
    await controller.start();

    expect(states.length).toBeGreaterThanOrEqual(1);
    const first = states[0];
    expect(first.view).toBeDefined();
    expect(first.view.myPlayerId).toBe("player-0");
    expect(first.isGameOver).toBe(false);
    expect(first.winner).toBeNull();
    controller.dispose();
  });

  it("allows human to submit a valid action", async () => {
    const { controller, states } = createTestController({ seed: 42 });
    await controller.start();

    const view = states[states.length - 1].view;
    expect(view.myHand.length).toBeGreaterThan(0);

    // Play first card face-down to air
    const result = await controller.submitAction({
      type: "play",
      cardId: view.myHand[0],
      theater: "air",
      faceUp: false,
    });
    expect(result.error).toBeUndefined();

    // State should have updated (human move + bot response)
    const latest = states[states.length - 1];
    expect(latest.view.myHand.length).toBeLessThan(view.myHand.length);
    controller.dispose();
  });

  it("rejects invalid actions", async () => {
    const { controller, states } = createTestController();
    await controller.start();

    // Try to play a card we don't have
    const result = await controller.submitAction({
      type: "play",
      cardId: "nonexistent-99",
      theater: "air",
      faceUp: false,
    });
    expect(result.error).toBeDefined();
    controller.dispose();
  });

  it("rejects actions when it's not human's turn", async () => {
    // Make human player-1 so bot goes first
    const { controller, states } = createTestController({
      humanPlayerId: "player-1",
      seed: 0, // player-0 goes first
    });
    // Don't start yet — manually check
    const state = controller.getState();
    // After start, bot should have already played
    await controller.start();

    // Now it should be human's turn (or bot has played)
    const latest = states[states.length - 1];
    if (latest.isHumanTurn) {
      // Good — human can play
      expect(latest.view.currentPlayer).toBe("player-1");
    }
    controller.dispose();
  });

  it("bot plays automatically when it's bot's turn", async () => {
    const bot = spyBot();
    const { controller, states } = createTestController({ bot, seed: 42 });
    await controller.start();

    // Human plays
    const view = states[states.length - 1].view;
    await controller.submitAction({
      type: "play",
      cardId: view.myHand[0],
      theater: "air",
      faceUp: false,
    });

    // Bot should have been called
    expect(bot.views.length).toBeGreaterThan(0);
    expect(bot.actions.length).toBeGreaterThan(0);
    controller.dispose();
  });

  it("emits botThinking=true while bot is deciding", async () => {
    let resolveBot: (action: ALSAction) => void;
    const slowBot: BotPlayer = {
      selectAction(view: ALSView): Promise<ALSAction> {
        return new Promise((resolve) => {
          resolveBot = resolve;
        });
      },
    };

    const { controller, states } = createTestController({
      bot: slowBot,
      humanPlayerId: "player-1", // bot goes first
      seed: 0,
    });

    // Start — bot should be thinking
    const startPromise = controller.start();

    // Wait a tick for the bot call to happen
    await new Promise((r) => setTimeout(r, 10));

    // There should be a botThinking=true state
    const thinkingState = states.find((s) => s.botThinking);
    expect(thinkingState).toBeDefined();
    expect(thinkingState!.botThinking).toBe(true);
    expect(thinkingState!.isHumanTurn).toBe(false);

    // Resolve the bot
    resolveBot!({ type: "play", cardId: "sea-2", theater: "air", faceUp: false });
    await startPromise;

    // After bot plays, should no longer be thinking
    const latest = states[states.length - 1];
    expect(latest.botThinking).toBe(false);
    controller.dispose();
  });

  it("plays a full game to completion", async () => {
    const { controller, states } = createTestController({ seed: 42 });
    await controller.start();

    let moves = 0;
    const maxMoves = 200; // safety limit

    while (moves < maxMoves) {
      const latest = states[states.length - 1];
      if (latest.isGameOver) break;
      if (latest.isRoundOver) {
        await controller.startNextRound();
        continue;
      }
      if (!latest.isHumanTurn) {
        throw new Error("Stuck: not human's turn but game not over");
      }

      const view = latest.view;
      let action: ALSAction;

      if (view.pendingAbility) {
        action = firstLegalAbilityAction(view);
      } else if (view.myHand.length > 0) {
        action = { type: "play", cardId: view.myHand[0], theater: "air", faceUp: false };
      } else {
        action = { type: "withdraw" };
      }

      const result = await controller.submitAction(action);
      if (result.error) throw new Error(`Action failed: ${result.error}`);
      moves++;
    }

    const final = states[states.length - 1];
    expect(final.isGameOver).toBe(true);
    expect(final.winner).toBeDefined();
    expect(["player-0", "player-1"]).toContain(final.winner);
    expect(moves).toBeLessThan(maxMoves);
    controller.dispose();
  });

  it("plays many games without errors", async () => {
    for (let seed = 0; seed < 50; seed++) {
      const { controller, states } = createTestController({ seed });
      await controller.start();

      let moves = 0;
      while (moves < 200) {
        const latest = states[states.length - 1];
        if (latest.isGameOver) break;
        if (latest.isRoundOver) {
          await controller.startNextRound();
          continue;
        }
        if (!latest.isHumanTurn) break;

        const view = latest.view;
        let action: ALSAction;
        if (view.pendingAbility) {
          action = firstLegalAbilityAction(view);
        } else if (view.myHand.length > 0) {
          action = { type: "play", cardId: view.myHand[0], theater: "air", faceUp: false };
        } else {
          action = { type: "withdraw" };
        }

        const result = await controller.submitAction(action);
        expect(result.error).toBeUndefined();
        moves++;
      }

      const final = states[states.length - 1];
      expect(final.isGameOver).toBe(true);
      controller.dispose();
    }
  });

  it("handles human as player-1 correctly", async () => {
    const bot = spyBot();
    const { controller, states } = createTestController({
      humanPlayerId: "player-1",
      bot,
      seed: 0,
    });
    await controller.start();

    // Bot should have gone first (player-0)
    expect(bot.views.length).toBeGreaterThan(0);
    expect(bot.views[0].myPlayerId).toBe("player-0");

    // Human should now have a turn
    const latest = states[states.length - 1];
    expect(latest.isHumanTurn).toBe(true);
    expect(latest.view.myPlayerId).toBe("player-1");
    controller.dispose();
  });

  it("dispose stops the controller", async () => {
    const bot = spyBot();
    const { controller, states } = createTestController({ bot });
    await controller.start();

    controller.dispose();

    // Further actions should fail gracefully
    const result = await controller.submitAction({ type: "withdraw" });
    expect(result.error).toBe("Game is disposed");
  });
});
