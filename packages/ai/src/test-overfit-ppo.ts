/**
 * PPO overfitting test: can the network learn to play a single fixed deal well?
 *
 * We fix the RNG seed so every game has the same starting hands and theater order.
 * Then run PPO self-play. If working, the network should converge on a strong
 * strategy for this specific deal, and we should see:
 * - One player winning consistently (the one with better cards for this deal)
 * - Action choices stabilizing (picking the same moves each time)
 * - Value predictions becoming confident (near +1 or -1 early in the game)
 */

import { init, defaultDevice } from "@jax-js/jax";
import { train, DEFAULT_CONFIG } from "./train.ts";
import { createModel, countParams, SMALL_CONFIG } from "./network.ts";
import { Environment, playGame, randomAction } from "./environment.ts";
import { decodeAction, listLegalActions } from "./encode.ts";
import type { ALSState } from "@card-games/shared/games/air-land-sea/types.ts";
import { fastAlsGame } from "./fast-engine.ts";
import { GameRunner } from "@card-games/shared";

const devices = await init();
defaultDevice(devices.includes("webgpu") ? "webgpu" : "wasm");

// First, let's see what the fixed deal looks like
const runner = new GameRunner(fastAlsGame, 0, 2);
const state = runner.getState() as ALSState;
console.log("=== Fixed Deal (seed=0) ===");
console.log("Theater order:", state.round!.theaterOrder);
console.log("Player-0 hand:", state.round!.hands["player-0"]);
console.log("Player-1 hand:", state.round!.hands["player-1"]);
console.log();

// Baseline: play 100 random games with this seed to see natural win rate
let p0RandomWins = 0;
for (let i = 0; i < 100; i++) {
  // Same seed=0 means same deal, but randomAction adds randomness in play
  const traj = playGame(0, randomAction);
  if (traj.winner === "player-0") p0RandomWins++;
}
console.log(`Random play win rate (p0): ${p0RandomWins}%`);
console.log();

// Train with PPO — all games use seed 0 (same deal every time)
const model = createModel(SMALL_CONFIG, 42);
console.log(`Parameters: ${countParams(model.params).toLocaleString()}`);

// Override generateBatch to always use seed 0
const config = {
  ...DEFAULT_CONFIG,
  batchGames: 128,    // small batch, same deal
  totalBatches: 100,
  ppoEpochs: 4,
  lr: 3e-4,
  clipEps: 0.2,
  entropyCoef: 0.02,
  logInterval: 10,
};

console.log("\nTraining on fixed deal...\n");
await train(model, config);

// Evaluate: play the trained model against random
console.log("\n=== Evaluation: Trained vs Random ===");
// We need to use the trained model to select actions
import { numpy as np, nn, random, jit, tree } from "@jax-js/jax";
import { STATE_SIZE, ACTION_SIZE, encodeState, legalActionMask } from "./encode.ts";

function makeGreedyPolicy(model: any) {
  return async (state: Float32Array, legalMask: Float32Array) => {
    const stateT = np.array(state).reshape([1, STATE_SIZE]);
    const maskT = np.array(legalMask).reshape([1, ACTION_SIZE]);
    const { logits } = model.forward(tree.ref(model.params), stateT);
    const maskedLogits = logits.add(maskT.sub(1).mul(1e9));
    const action = np.argmax(maskedLogits.reshape([-1]), -1);
    const actionIdx = ((await action.data()) as Int32Array)[0];
    return actionIdx;
  };
}

// Play games where trained model is p0, random is p1
// (and vice versa)
const greedyPolicy = makeGreedyPolicy(model);

let trainedAsP0Wins = 0;
let trainedAsP1Wins = 0;
const EVAL_GAMES = 100;

for (let i = 0; i < EVAL_GAMES; i++) {
  const env = new Environment(0);  // same deal
  while (!env.isDone()) {
    const obs = env.observe();
    let hasLegal = false;
    for (let j = 0; j < obs.legalMask.length; j++) {
      if (obs.legalMask[j] > 0.5) { hasLegal = true; break; }
    }
    if (!hasLegal) { env.forceSkipAbility(); continue; }

    let action: number;
    if (obs.playerId === "player-0") {
      action = await greedyPolicy(obs.state, obs.legalMask);
      if (action < 0 || action >= ACTION_SIZE || obs.legalMask[action] < 0.5) {
        action = 0;
        for (let j = 0; j < ACTION_SIZE; j++) { if (obs.legalMask[j] > 0.5) { action = j; break; } }
      }
    } else {
      action = randomAction(obs.state, obs.legalMask);
    }
    env.step(action, { state: obs.state, legalMask: obs.legalMask });
  }
  if (env.finish().winner === "player-0") trainedAsP0Wins++;
}

for (let i = 0; i < EVAL_GAMES; i++) {
  const env = new Environment(0);
  while (!env.isDone()) {
    const obs = env.observe();
    let hasLegal = false;
    for (let j = 0; j < obs.legalMask.length; j++) {
      if (obs.legalMask[j] > 0.5) { hasLegal = true; break; }
    }
    if (!hasLegal) { env.forceSkipAbility(); continue; }

    let action: number;
    if (obs.playerId === "player-1") {
      action = await greedyPolicy(obs.state, obs.legalMask);
      if (action < 0 || action >= ACTION_SIZE || obs.legalMask[action] < 0.5) {
        action = 0;
        for (let j = 0; j < ACTION_SIZE; j++) { if (obs.legalMask[j] > 0.5) { action = j; break; } }
      }
    } else {
      action = randomAction(obs.state, obs.legalMask);
    }
    env.step(action, { state: obs.state, legalMask: obs.legalMask });
  }
  if (env.finish().winner === "player-1") trainedAsP1Wins++;
}

console.log(`Trained as P0 vs Random: ${trainedAsP0Wins}/${EVAL_GAMES} wins`);
console.log(`Trained as P1 vs Random: ${trainedAsP1Wins}/${EVAL_GAMES} wins`);
console.log(`Random baseline was: ${p0RandomWins}% for P0`);

// Show what the trained model does on turn 1
console.log("\n=== Turn 1 action preferences ===");
{
  const env = new Environment(0);
  const obs = env.observe();
  const stateT = np.array(obs.state).reshape([1, STATE_SIZE]);
  const maskT = np.array(obs.legalMask).reshape([1, ACTION_SIZE]);
  const { logits, values } = model.forward(tree.ref(model.params), stateT);
  const maskedLogits = logits.add(maskT.sub(1).mul(1e9));
  const probs = nn.softmax(maskedLogits);
  const probsData = await probs.data() as Float32Array;
  const valData = await values.data() as Float32Array;

  console.log(`Value estimate: ${valData[0].toFixed(3)} (>0 = thinks P0 wins)`);

  const legal = listLegalActions(obs.legalMask);
  const actionProbs: { action: string; prob: number }[] = [];
  for (let i = 0; i < ACTION_SIZE; i++) {
    if (obs.legalMask[i] > 0.5) {
      const a = decodeAction(i);
      const desc = a.type === "play"
        ? `play ${a.cardId} → ${a.theater} ${a.faceUp ? "up" : "down"}`
        : a.type;
      actionProbs.push({ action: desc, prob: probsData[i] });
    }
  }
  actionProbs.sort((a, b) => b.prob - a.prob);
  for (const { action, prob } of actionProbs.slice(0, 10)) {
    console.log(`  ${(prob * 100).toFixed(1)}%  ${action}`);
  }
}
