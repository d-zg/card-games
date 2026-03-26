/**
 * Evaluate trained models against heuristic bot and each other.
 */

import { init, defaultDevice } from "@jax-js/jax";
import { Bot } from "./bot.ts";
import { HeuristicBot } from "@card-games/shared/games/air-land-sea/heuristic-bot.ts";
import { GameRunner } from "@card-games/shared";
import { alsGame } from "@card-games/shared/games/air-land-sea/index.ts";
import type { ALSState, ALSAction, ALSView } from "@card-games/shared/games/air-land-sea/types.ts";
import type { PlayerId } from "@card-games/shared/types.ts";
import type { BotPlayer } from "@card-games/shared/games/air-land-sea/local-game-controller.ts";
import { legalActionMask, decodeAction } from "./encode.ts";
import { randomAction } from "./environment.ts";

const devices = await init();
defaultDevice(devices.includes("webgpu") ? "webgpu" : "wasm");

const CKPT_DIR = "./checkpoints";
const NUM_GAMES = 200;

// Load models
console.log("Loading models...");
const smallBot = await Bot.load(CKPT_DIR, "small-126k-batch200");
const largeBot = await Bot.load(CKPT_DIR, "large-2m-batch200");
const heuristic = new HeuristicBot();

// Helper: play N games between two bot players
async function playMatch(
  nameA: string, botA: BotPlayer,
  nameB: string, botB: BotPlayer,
  numGames: number,
): Promise<void> {
  let aWinsAsP0 = 0;
  let aWinsAsP1 = 0;

  // A as player-0, B as player-1
  for (let i = 0; i < numGames; i++) {
    const result = await playOneGame(botA, botB, i);
    if (result.winner === "player-0") aWinsAsP0++;
    Deno.stdout.writeSync(new TextEncoder().encode(
      `\r  [${nameA} as P0] ${i + 1}/${numGames}: ${aWinsAsP0} wins | last: ${result.scores.p0}-${result.scores.p1}`
    ));
  }
  console.log();

  // A as player-1, B as player-0
  for (let i = 0; i < numGames; i++) {
    const result = await playOneGame(botB, botA, numGames + i);
    if (result.winner === "player-1") aWinsAsP1++;
    Deno.stdout.writeSync(new TextEncoder().encode(
      `\r  [${nameA} as P1] ${i + 1}/${numGames}: ${aWinsAsP1} wins | last: ${result.scores.p0}-${result.scores.p1}`
    ));
  }

  const total = aWinsAsP0 + aWinsAsP1;
  console.log(
    `${nameA} vs ${nameB}: ` +
    `${total}/${numGames * 2} (${(total / numGames / 2 * 100).toFixed(0)}%) ` +
    `[as P0: ${aWinsAsP0}/${numGames}, as P1: ${aWinsAsP1}/${numGames}]`
  );
}

interface GameResult {
  winner: PlayerId;
  scores: { p0: number; p1: number };
}

async function playOneGame(p0Bot: BotPlayer, p1Bot: BotPlayer, seed: number): Promise<GameResult> {
  const runner = new GameRunner(alsGame, seed, 2);
  let moves = 0;
  while (!runner.getWinner() && moves < 500) {
    const state = runner.getState() as ALSState;
    if (state.phase === "round-over") {
      runner.applyAction("player-0", { type: "start-next-round" });
      continue;
    }
    if (state.phase === "game-over") break;

    const activeIds = runner.getActivePlayerIds();
    if (activeIds.length === 0) break;
    const pid = activeIds[0] as PlayerId;
    const view = runner.getView(pid) as ALSView;

    const bot = pid === "player-0" ? p0Bot : p1Bot;
    try {
      const action = await bot.selectAction(view);
      runner.applyAction(pid, action);
    } catch {
      try {
        if (view.myHand.length > 0) {
          runner.applyAction(pid, { type: "play", cardId: view.myHand[0], theater: "air", faceUp: false });
        } else {
          runner.applyAction(pid, { type: "withdraw" });
        }
      } catch {
        break;
      }
    }
    moves++;
  }
  const state = runner.getState() as ALSState;
  const winner = runner.getWinner();
  return {
    winner: winner ? winner[0] as PlayerId : "player-0",
    scores: {
      p0: state.scores["player-0"] ?? 0,
      p1: state.scores["player-1"] ?? 0,
    },
  };
}

// Random bot wrapper
const randomBot: BotPlayer = {
  async selectAction(view: ALSView): Promise<ALSAction> {
    const mask = legalActionMask(view);
    const idx = randomAction(new Float32Array(1), mask);
    return decodeAction(idx);
  },
};

console.log(`\nEvaluating ${NUM_GAMES} games per side (${NUM_GAMES * 2} total per matchup)...\n`);

console.log("=== vs Heuristic ===");
await playMatch("Small (126k)", smallBot, "Heuristic", heuristic, NUM_GAMES);
await playMatch("Large (2M)", largeBot, "Heuristic", heuristic, NUM_GAMES);

console.log("\n=== vs Random ===");
await playMatch("Small (126k)", smallBot, "Random", randomBot, NUM_GAMES);
await playMatch("Large (2M)", largeBot, "Random", randomBot, NUM_GAMES);
await playMatch("Heuristic", heuristic, "Random", randomBot, NUM_GAMES);

console.log("\n=== Head to Head ===");
await playMatch("Large (2M)", largeBot, "Small (126k)", smallBot, NUM_GAMES);
