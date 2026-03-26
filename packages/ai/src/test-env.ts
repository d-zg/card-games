/**
 * Test the environment wrapper by playing games with random actions.
 */

import { playGame, randomAction } from "./environment.ts";
import { STATE_SIZE, ACTION_SIZE, decodeAction } from "./encode.ts";

console.log(`State size: ${STATE_SIZE}, Action size: ${ACTION_SIZE}`);
console.log();

// Play several random games
const NUM_GAMES = 100;
const stats = { p0Wins: 0, p1Wins: 0, totalSteps: 0, minSteps: Infinity, maxSteps: 0 };

for (let i = 0; i < NUM_GAMES; i++) {
  const traj = playGame(i, randomAction);

  stats.totalSteps += traj.steps.length;
  stats.minSteps = Math.min(stats.minSteps, traj.steps.length);
  stats.maxSteps = Math.max(stats.maxSteps, traj.steps.length);
  if (traj.winner === "player-0") stats.p0Wins++;
  else stats.p1Wins++;

  // Verify rewards
  const posRewards = traj.rewards.filter((r) => r > 0).length;
  const negRewards = traj.rewards.filter((r) => r < 0).length;
  if (posRewards + negRewards !== traj.steps.length) {
    console.error(`Game ${i}: reward count mismatch`);
  }
}

console.log(`=== ${NUM_GAMES} Random Games ===`);
console.log(`Player-0 wins: ${stats.p0Wins}, Player-1 wins: ${stats.p1Wins}`);
console.log(`Avg steps per game: ${(stats.totalSteps / NUM_GAMES).toFixed(1)}`);
console.log(`Step range: ${stats.minSteps} - ${stats.maxSteps}`);
console.log();

// Detailed look at one game
console.log("=== Detailed Game (seed=42) ===");
const traj = playGame(42, randomAction);
console.log(`Winner: ${traj.winner}`);
console.log(`Total steps: ${traj.steps.length}`);
console.log();

for (let i = 0; i < traj.steps.length; i++) {
  const step = traj.steps[i];
  const action = decodeAction(step.actionIndex);
  const reward = traj.rewards[i];
  const brief = action.type === "play"
    ? `play ${action.cardId} → ${action.theater} ${action.faceUp ? "face-up" : "face-down"}`
    : action.type === "withdraw"
    ? "withdraw"
    : JSON.stringify(action);
  console.log(`  ${i}: ${step.playerId} ${brief} (reward: ${reward > 0 ? "+1" : "-1"})`);
}
