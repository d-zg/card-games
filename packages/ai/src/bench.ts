/**
 * Benchmark: how many games per second can we generate?
 */

import { playGame, randomAction } from "./environment.ts";

// Warmup
for (let i = 0; i < 100; i++) {
  playGame(i, randomAction);
}

// Benchmark
const NUM_GAMES = 10_000;
const start = performance.now();

let totalSteps = 0;
for (let i = 0; i < NUM_GAMES; i++) {
  const traj = playGame(1000 + i, randomAction);
  totalSteps += traj.steps.length;
}

const elapsed = performance.now() - start;
const gamesPerSec = NUM_GAMES / (elapsed / 1000);
const stepsPerSec = totalSteps / (elapsed / 1000);

console.log(`${NUM_GAMES} games in ${(elapsed / 1000).toFixed(2)}s`);
console.log(`${gamesPerSec.toFixed(0)} games/sec`);
console.log(`${stepsPerSec.toFixed(0)} steps/sec`);
console.log(`${totalSteps} total steps (${(totalSteps / NUM_GAMES).toFixed(1)} avg)`);
