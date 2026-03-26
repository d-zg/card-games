/**
 * Generalized Advantage Estimation (GAE) for per-game trajectories.
 *
 * Instead of advantage = reward - value (same for every step),
 * GAE uses temporal differences discounted backward through the game:
 *
 *   delta_t = reward_t + gamma * V(s_{t+1}) - V(s_t)
 *   A_t = delta_t + gamma * lambda * A_{t+1}
 *
 * This gives cleaner credit assignment — moves near the end of the game
 * get stronger signal, and the value head bootstraps for earlier moves.
 */

export interface GameStep {
  value: number;       // V(s_t) — value estimate at this state
  reward: number;      // r_t — reward for this step (+1/-1, or 0 for non-terminal)
}

export interface GAEResult {
  advantages: Float32Array;
  returns: Float32Array;
}

/**
 * Compute GAE for a single game trajectory.
 *
 * @param steps - ordered sequence of steps from one game (both players interleaved)
 * @param gamma - discount factor (0.99 typical)
 * @param lambda - GAE lambda (0.95 typical) — controls bias/variance tradeoff
 * @param terminalValue - V(s_terminal), usually 0 since the game is over
 */
export function computeGAEForGame(
  steps: GameStep[],
  gamma: number,
  lambda: number,
  terminalValue = 0,
): GAEResult {
  const n = steps.length;
  const advantages = new Float32Array(n);
  const returns = new Float32Array(n);

  let lastAdvantage = 0;

  // Walk backward through the game
  for (let t = n - 1; t >= 0; t--) {
    const nextValue = t === n - 1 ? terminalValue : steps[t + 1].value;
    const delta = steps[t].reward + gamma * nextValue - steps[t].value;
    lastAdvantage = delta + gamma * lambda * lastAdvantage;
    advantages[t] = lastAdvantage;
    returns[t] = advantages[t] + steps[t].value;
  }

  return { advantages, returns };
}

/**
 * Compute GAE across multiple games, then normalize advantages globally.
 *
 * @param games - array of per-game step arrays
 * @param gamma - discount factor
 * @param lambda - GAE lambda
 * @returns flattened advantages and returns across all games, normalized
 */
export function computeGAEBatch(
  games: GameStep[][],
  gamma: number,
  lambda: number,
): GAEResult {
  // Compute per-game GAE
  const perGame = games.map((steps) => computeGAEForGame(steps, gamma, lambda));

  // Count total steps
  const totalSteps = games.reduce((sum, g) => sum + g.length, 0);
  const advantages = new Float32Array(totalSteps);
  const returns = new Float32Array(totalSteps);

  // Flatten
  let offset = 0;
  for (const gae of perGame) {
    advantages.set(gae.advantages, offset);
    returns.set(gae.returns, offset);
    offset += gae.advantages.length;
  }

  // Normalize advantages to zero mean, unit variance
  let mean = 0;
  for (let i = 0; i < totalSteps; i++) mean += advantages[i];
  mean /= totalSteps;

  let variance = 0;
  for (let i = 0; i < totalSteps; i++) variance += (advantages[i] - mean) ** 2;
  const std = Math.sqrt(variance / totalSteps + 1e-8);

  for (let i = 0; i < totalSteps; i++) {
    advantages[i] = (advantages[i] - mean) / std;
  }

  return { advantages, returns };
}
