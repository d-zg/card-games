/**
 * Main training entry point.
 *
 * Usage:
 *   deno task train
 *
 * Trains a neural network to play Air, Land & Sea via PPO self-play.
 * Saves checkpoints to ./checkpoints/ and evaluates against random play.
 */

import { init, defaultDevice } from "@jax-js/jax";
import { train } from "./train.ts";
import { createModel, countParams, SMALL_CONFIG, MEDIUM_CONFIG, LARGE_CONFIG, type NetworkConfig } from "./network.ts";
import { Bot } from "./bot.ts";
import { Environment, randomAction } from "./environment.ts";
import { ACTION_SIZE } from "./encode.ts";

// ============================================================
// Configuration
// ============================================================

const NETWORK = LARGE_CONFIG;
const CHECKPOINT_DIR = "./checkpoints/large";

const TRAIN_CONFIG = {
  batchGames: 2048,
  clipEps: 0.2,
  valueLossCoef: 0.5,
  entropyCoef: 0.02,
  lr: 3e-4,
  ppoEpochs: 4,
  totalBatches: 500,
  logInterval: 10,
  gamma: 0.99,
  gaeLambda: 0.95,
  checkpointDir: CHECKPOINT_DIR,
  checkpointInterval: 100,
  networkConfig: { hiddenLayers: NETWORK.hiddenLayers },
};

// ============================================================
// Evaluation
// ============================================================

async function evaluate(bot: Bot, numGames: number): Promise<{ asP0: number; asP1: number }> {
  let p0Wins = 0;
  let p1Wins = 0;

  for (let i = 0; i < numGames; i++) {
    // Bot as P0
    const env0 = new Environment(i * 2);
    while (!env0.isDone()) {
      const obs = env0.observe();
      let hasLegal = false;
      for (let j = 0; j < obs.legalMask.length; j++) {
        if (obs.legalMask[j] > 0.5) { hasLegal = true; break; }
      }
      if (!hasLegal) { env0.forceSkipAbility(); continue; }

      let action: number;
      if (obs.playerId === "player-0") {
        const alsAction = await bot.selectAction(
          (env0 as any).runner.getView(obs.playerId),
        );
        const { encodeAction } = await import("./encode.ts");
        action = encodeAction(alsAction);
        if (action < 0 || obs.legalMask[action] < 0.5) {
          action = 0;
          for (let j = 0; j < ACTION_SIZE; j++) { if (obs.legalMask[j] > 0.5) { action = j; break; } }
        }
      } else {
        action = randomAction(obs.state, obs.legalMask);
      }
      env0.step(action, { state: obs.state, legalMask: obs.legalMask });
    }
    if (env0.finish().winner === "player-0") p0Wins++;

    // Bot as P1
    const env1 = new Environment(i * 2 + 1);
    while (!env1.isDone()) {
      const obs = env1.observe();
      let hasLegal = false;
      for (let j = 0; j < obs.legalMask.length; j++) {
        if (obs.legalMask[j] > 0.5) { hasLegal = true; break; }
      }
      if (!hasLegal) { env1.forceSkipAbility(); continue; }

      let action: number;
      if (obs.playerId === "player-1") {
        const alsAction = await bot.selectAction(
          (env1 as any).runner.getView(obs.playerId),
        );
        const { encodeAction } = await import("./encode.ts");
        action = encodeAction(alsAction);
        if (action < 0 || obs.legalMask[action] < 0.5) {
          action = 0;
          for (let j = 0; j < ACTION_SIZE; j++) { if (obs.legalMask[j] > 0.5) { action = j; break; } }
        }
      } else {
        action = randomAction(obs.state, obs.legalMask);
      }
      env1.step(action, { state: obs.state, legalMask: obs.legalMask });
    }
    if (env1.finish().winner === "player-1") p1Wins++;
  }

  return { asP0: p0Wins / numGames, asP1: p1Wins / numGames };
}

// ============================================================
// Main
// ============================================================

const devices = await init();
if (devices.includes("webgpu")) {
  defaultDevice("webgpu");
  console.log("Device: WebGPU");
} else {
  defaultDevice("wasm");
  console.log("Device: Wasm (CPU)");
}

const model = createModel(NETWORK, 42);
console.log(`Network: ${NETWORK.hiddenLayers.join(" → ")}`);
console.log(`Parameters: ${countParams(model.params).toLocaleString()}`);
console.log();

// Train
const startTime = performance.now();
await train(model, TRAIN_CONFIG);
const elapsed = (performance.now() - startTime) / 1000;
console.log(`Total training time: ${(elapsed / 60).toFixed(1)} minutes`);

// Final evaluation
console.log("\n=== Final Evaluation (100 games vs random) ===");
const bot = Bot.fromParams(model.params, NETWORK.hiddenLayers.length);
const { asP0, asP1 } = await evaluate(bot, 100);
console.log(`Bot as P0: ${(asP0 * 100).toFixed(0)}% win rate`);
console.log(`Bot as P1: ${(asP1 * 100).toFixed(0)}% win rate`);
console.log(`Average: ${((asP0 + asP1) / 2 * 100).toFixed(0)}% (50% = random, higher = better)`);
