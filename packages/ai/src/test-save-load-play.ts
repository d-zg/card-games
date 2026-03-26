/**
 * End-to-end test: train → save → load → play as bot.
 */

import { init, defaultDevice } from "@jax-js/jax";
import { train, DEFAULT_CONFIG } from "./train.ts";
import { createModel, countParams, SMALL_CONFIG } from "./network.ts";
import { Bot } from "./bot.ts";
import { Environment, randomAction } from "./environment.ts";
import { ACTION_SIZE } from "./encode.ts";
import { listCheckpoints } from "./save-load.ts";

const devices = await init();
defaultDevice(devices.includes("webgpu") ? "webgpu" : "wasm");

const CKPT_DIR = "/Users/daniel/Projects/card-games/packages/ai/checkpoints";

// 1. Train for a bit
console.log("=== Step 1: Train ===\n");
const model = createModel(SMALL_CONFIG, 42);
console.log(`Parameters: ${countParams(model.params).toLocaleString()}`);

await train(model, {
  ...DEFAULT_CONFIG,
  batchGames: 128,
  totalBatches: 20,
  ppoEpochs: 4,
  lr: 3e-4,
  clipEps: 0.2,
  entropyCoef: 0.02,
  logInterval: 5,
  checkpointDir: CKPT_DIR,
  checkpointInterval: 10,
  networkConfig: { hiddenLayers: SMALL_CONFIG.hiddenLayers },
});

// 2. List saved checkpoints
console.log("\n=== Step 2: Saved checkpoints ===");
const checkpoints = await listCheckpoints(CKPT_DIR);
console.log("Checkpoints:", checkpoints);

// 3. Load bot from checkpoint
console.log("\n=== Step 3: Load bot ===");
const bot = await Bot.load(CKPT_DIR, "latest");

// 4. Play games: bot vs random
console.log("\n=== Step 4: Bot vs Random ===");
let botWins = 0;
const GAMES = 50;

for (let i = 0; i < GAMES; i++) {
  const env = new Environment(i * 1000);
  while (!env.isDone()) {
    const obs = env.observe();
    let hasLegal = false;
    for (let j = 0; j < obs.legalMask.length; j++) {
      if (obs.legalMask[j] > 0.5) { hasLegal = true; break; }
    }
    if (!hasLegal) { env.forceSkipAbility(); continue; }

    let action: number;
    if (obs.playerId === "player-0") {
      // Bot plays as P0
      const view = { ...obs, myPlayerId: obs.playerId } as any;
      // We need an ALSView — let's use the environment's internal view
      // Actually the bot.selectAction takes an ALSView, but we have encoded state.
      // Let me use the bot with the raw view from the runner.
      const alsAction = await bot.selectAction(
        (env as any).runner.getView(obs.playerId),
      );
      // Encode the action to an index
      const { encodeAction } = await import("./encode.ts");
      action = encodeAction(alsAction);
      if (action < 0 || obs.legalMask[action] < 0.5) {
        action = 0;
        for (let j = 0; j < ACTION_SIZE; j++) { if (obs.legalMask[j] > 0.5) { action = j; break; } }
      }
    } else {
      action = randomAction(obs.state, obs.legalMask);
    }
    env.step(action, { state: obs.state, legalMask: obs.legalMask });
  }
  if (env.finish().winner === "player-0") botWins++;
}

console.log(`Bot (P0) vs Random: ${botWins}/${GAMES} wins (${(botWins/GAMES*100).toFixed(0)}%)`);
console.log(`(50% = no better than random, >60% = learning something)`);

// 5. Show bot's evaluation of a starting position
console.log("\n=== Step 5: Bot evaluation ===");
const env = new Environment(42);
const view = (env as any).runner.getView("player-0");
const value = await bot.evaluate(view);
console.log(`Position value: ${value.toFixed(3)} (-1=losing, 0=even, +1=winning)`);
const action = await bot.selectAction(view);
console.log(`Chosen action: ${JSON.stringify(action)}`);
