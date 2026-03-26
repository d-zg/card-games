/**
 * PPO training harness for Air, Land & Sea.
 *
 * Runs parallel self-play games, collects trajectories, and performs
 * PPO updates using jax-js + optax.
 */

import { numpy as np, nn, random, valueAndGrad, jit, tree } from "@jax-js/jax";
import { adam, applyUpdates } from "@jax-js/optax";
import { Environment } from "./environment.ts";
import { STATE_SIZE, ACTION_SIZE } from "./encode.ts";
import { saveCheckpoint } from "./save-load.ts";
import { computeGAEBatch, type GameStep } from "./gae.ts";
import type { PlayerId } from "@card-games/shared/types.ts";

// ============================================================
// Model interface
// ============================================================

export interface Model {
  forward(params: Params, states: any): { logits: any; values: any };
  params: Params;
}

export type Params = Record<string, any>;

// ============================================================
// Hyperparameters
// ============================================================

export interface TrainConfig {
  batchGames: number;
  clipEps: number;
  valueLossCoef: number;
  entropyCoef: number;
  lr: number;
  ppoEpochs: number;
  totalBatches: number;
  logInterval: number;
  /** Discount factor for GAE. */
  gamma: number;
  /** GAE lambda (bias/variance tradeoff). */
  gaeLambda: number;
  /** Directory to save checkpoints. Null to disable. */
  checkpointDir?: string | null;
  /** Save a checkpoint every N batches. */
  checkpointInterval?: number;
  /** Network config to store in checkpoint metadata. */
  networkConfig?: Record<string, any>;
}

export const DEFAULT_CONFIG: TrainConfig = {
  batchGames: 256,
  clipEps: 0.2,
  valueLossCoef: 0.5,
  entropyCoef: 0.01,
  lr: 3e-4,
  ppoEpochs: 4,
  totalBatches: 500,
  logInterval: 10,
  gamma: 0.99,
  gaeLambda: 0.95,
};

// ============================================================
// Step data
// ============================================================

interface StepData {
  state: Float32Array;
  legalMask: Float32Array;
  action: number;
  logProb: number;
  value: number;
  reward: number;
  playerId: PlayerId;
}

// ============================================================
// Tensor utilities
// ============================================================

/** Masked softmax using the mask-as-additive-bias trick. */
function maskedSoftmax(logits: any, mask: any): any {
  const masked = logits.add(mask.sub(1).mul(1e9));
  return nn.softmax(masked);
}


// ============================================================
// JIT'd inference function (created once per model)
// ============================================================

let _inferFn: any = null;

/**
 * JIT'd inference: forward pass + masked sampling + log-prob, all on GPU.
 * Returns [actions (int), logProbs (float), values (float)] — small tensors.
 */
function getInferFn(model: Model) {
  if (!_inferFn) {
    _inferFn = jit((params: any, states: any, masks: any, rngKey: any) => {
      const { logits, values } = model.forward(params, states);

      // Mask illegal actions with large negative before sampling
      const maskedLogits = logits.add(masks.ref.sub(1).mul(1e9));

      // Sample actions from masked logits (categorical takes logits directly)
      const actions = random.categorical(rngKey, maskedLogits.ref);

      // Compute log-prob of selected actions, clamped to avoid extreme values
      const logProbs = nn.logSoftmax(maskedLogits);
      const oneHot = nn.oneHot(actions.ref, ACTION_SIZE);
      const selectedLogProbs = np.clip(np.sum(logProbs.mul(oneHot), [-1]), -20, 0);

      return [actions, selectedLogProbs, values];
    });
  }
  return _inferFn;
}

// ============================================================
// JIT'd loss+grad function (created once, reused across batches)
// ============================================================

let _lossAndGradFn: any = null;

function getLossAndGradFn(model: Model, config: TrainConfig) {
  if (!_lossAndGradFn) {
    const { clipEps, valueLossCoef, entropyCoef } = config;

    _lossAndGradFn = jit(valueAndGrad(
      (params: Params, states: any, masks: any, actionOneHots: any,
       oldLogProbs: any, advantages: any, returns: any) => {
        const { logits, values } = model.forward(params, states);

        // Policy — use logSoftmax directly (numerically stable)
        const maskedLogits = logits.add(masks.ref.sub(1).mul(1e9));
        const logProbs = nn.logSoftmax(maskedLogits);
        const newLogProbs = np.sum(logProbs.ref.mul(actionOneHots), [-1]);

        // Clipped surrogate
        const ratio = np.exp(newLogProbs.sub(oldLogProbs));
        const clipped = np.clip(ratio.ref, 1 - clipEps, 1 + clipEps);
        const policyLoss = np.mean(np.minimum(
          ratio.mul(advantages.ref), clipped.mul(advantages)
        )).mul(-1);

        // Value loss
        const valueLoss = np.mean(np.square(values.sub(returns)));

        // Entropy bonus (from logProbs directly: -sum(exp(lp) * lp))
        const probs = np.exp(logProbs.ref);
        const entropy = np.mean(np.sum(probs.mul(logProbs).mul(-1), [-1]));

        return policyLoss.add(valueLoss.mul(valueLossCoef)).sub(entropy.mul(entropyCoef));
      },
    ));
  }
  return _lossAndGradFn;
}

// ============================================================
// Self-play with fixed-size batching
// ============================================================

async function generateBatch(
  model: Model,
  config: TrainConfig,
  seedBase: number,
): Promise<{ games: StepData[][]; stats: BatchStats }> {
  const batchSize = config.batchGames;
  const inferFn = getInferFn(model);

  const envs = Array.from({ length: batchSize }, (_, i) =>
    new Environment(seedBase + i)
  );
  const completedGames: StepData[][] = [];
  const perGameSteps: StepData[][] = envs.map(() => []);
  const active = new Set(envs.map((_, i) => i));
  let totalSteps = 0;
  let rngKey = random.key(seedBase);

  // Pre-allocate CPU buffers at fixed batch size (reused every iteration)
  const statesBuf = new Float32Array(batchSize * STATE_SIZE);
  const masksBuf = new Float32Array(batchSize * ACTION_SIZE);

  // Per-slot tracking
  const slotToGame: number[] = new Array(batchSize);
  const slotObs: { state: Float32Array; legalMask: Float32Array; playerId: PlayerId }[] = new Array(batchSize);

  while (active.size > 0) {
    statesBuf.fill(0);
    masksBuf.fill(0);

    let slotCount = 0;
    const skippedGames: number[] = [];

    for (const g of active) {
      const obs = envs[g].observe();

      let hasLegal = false;
      for (let i = 0; i < obs.legalMask.length; i++) {
        if (obs.legalMask[i] > 0.5) { hasLegal = true; break; }
      }
      if (!hasLegal) {
        skippedGames.push(g);
        continue;
      }

      statesBuf.set(obs.state, slotCount * STATE_SIZE);
      masksBuf.set(obs.legalMask, slotCount * ACTION_SIZE);
      slotToGame[slotCount] = g;
      slotObs[slotCount] = { state: obs.state, legalMask: obs.legalMask, playerId: obs.playerId };
      slotCount++;
    }

    for (const g of skippedGames) {
      envs[g].forceSkipAbility();
    }

    if (slotCount === 0) continue;

    // For padded slots (slotCount..batchSize-1), set mask[0]=1 so categorical
    // doesn't produce out-of-range indices on all-zero rows
    for (let s = slotCount; s < batchSize; s++) {
      masksBuf[s * ACTION_SIZE] = 1;
    }

    // Fixed-size tensors (always batchSize, padded with zeros)
    const statesTensor = np.array(statesBuf).reshape([batchSize, STATE_SIZE]);
    const masksTensor = np.array(masksBuf).reshape([batchSize, ACTION_SIZE]);

    // Split RNG key for this step
    const [stepKey, nextKey] = random.split(rngKey);
    rngKey = nextKey;

    // Forward + sample + log-prob, all on GPU
    // Returns: actions [batchSize], logProbs [batchSize], values [batchSize]
    const [actions, logProbs, values] = inferFn(
      tree.ref(model.params), statesTensor, masksTensor, stepKey,
    );

    // Only copy back 3 small vectors (batchSize each) instead of full prob matrix
    const [actionsData, logProbsData, valuesData] = await Promise.all([
      actions.data() as Promise<Int32Array>,
      logProbs.data() as Promise<Float32Array>,
      values.data() as Promise<Float32Array>,
    ]);

    // Step only active games
    for (let slot = 0; slot < slotCount; slot++) {
      const g = slotToGame[slot];
      const obs = slotObs[slot];
      const env = envs[g];

      let action = actionsData[slot];

      // Verify action is in range and legal
      if (action < 0 || action >= ACTION_SIZE || obs.legalMask[action] < 0.5) {
        action = 0;
        for (let i = 0; i < ACTION_SIZE; i++) {
          if (obs.legalMask[i] > 0.5) { action = i; break; }
        }
      }

      let logProb = logProbsData[slot];
      // Clamp log-prob to avoid -inf/NaN from low-probability actions
      if (!isFinite(logProb)) logProb = -20;

      perGameSteps[g].push({
        state: obs.state,
        legalMask: obs.legalMask,
        action,
        logProb,
        value: valuesData[slot],
        reward: 0,
        playerId: obs.playerId,
      });

      const done = env.step(action, obs);
      totalSteps++;

      if (done) {
        const traj = env.finish();
        const gameSteps = perGameSteps[g];
        // Terminal-only rewards: only the last step for each player gets +1/-1
        // All other steps get 0. GAE will bootstrap the rest via the value head.
        for (let s = 0; s < gameSteps.length; s++) {
          gameSteps[s].reward = 0;
        }
        // Assign terminal reward to the last step of the game
        if (gameSteps.length > 0) {
          const lastStep = gameSteps[gameSteps.length - 1];
          lastStep.reward = lastStep.playerId === traj.winner ? 1 : -1;
          // Also assign to second-to-last (the other player's last move)
          if (gameSteps.length >= 2) {
            const prevStep = gameSteps[gameSteps.length - 2];
            prevStep.reward = prevStep.playerId === traj.winner ? 1 : -1;
          }
        }
        completedGames.push(gameSteps);
        active.delete(g);
      }
    }
  }

  return {
    games: completedGames,
    stats: { totalSteps, gamesPlayed: batchSize, avgStepsPerGame: totalSteps / batchSize },
  };
}

interface BatchStats {
  totalSteps: number;
  gamesPlayed: number;
  avgStepsPerGame: number;
}

// ============================================================
// PPO update
// ============================================================


async function ppoUpdate(
  model: Model,
  games: StepData[][],
  config: TrainConfig,
  solver: any,
  optState: any,
): Promise<{ loss: number; optState: any }> {
  const lossAndGrad = getLossAndGradFn(model, config);

  // Compute GAE per-game, then flatten
  const gameStepsForGAE: GameStep[][] = games.map((game) =>
    game.map((s) => ({ value: s.value, reward: s.reward }))
  );
  const { advantages, returns } = computeGAEBatch(gameStepsForGAE, config.gamma, config.gaeLambda);

  // Flatten games into a single array for tensor packing
  const steps = games.flat();
  const n = steps.length;

  // Pack step data into tensors
  const statesBuf = new Float32Array(n * STATE_SIZE);
  const masksBuf = new Float32Array(n * ACTION_SIZE);
  const actionsBuf = new Float32Array(n * ACTION_SIZE);
  const oldLogProbsBuf = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    statesBuf.set(steps[i].state, i * STATE_SIZE);
    masksBuf.set(steps[i].legalMask, i * ACTION_SIZE);
    actionsBuf[i * ACTION_SIZE + steps[i].action] = 1;
    oldLogProbsBuf[i] = steps[i].logProb;
  }

  const statesTensor = np.array(statesBuf).reshape([n, STATE_SIZE]);
  const masksTensor = np.array(masksBuf).reshape([n, ACTION_SIZE]);
  const actionsTensor = np.array(actionsBuf).reshape([n, ACTION_SIZE]);
  const oldLogProbsTensor = np.array(oldLogProbsBuf);
  const advantagesTensor = np.array(advantages);
  const returnsTensor = np.array(returns);

  let lastLoss = 0;
  for (let epoch = 0; epoch < config.ppoEpochs; epoch++) {
    const [loss, grads] = lossAndGrad(
      tree.ref(model.params),
      statesTensor.ref, masksTensor.ref, actionsTensor.ref,
      oldLogProbsTensor.ref, advantagesTensor.ref, returnsTensor.ref,
    );

    lastLoss = ((await loss.data()) as Float32Array)[0];

    // Skip update if loss is NaN (prevents corrupting params)
    if (!isFinite(lastLoss)) {
      console.warn("Warning: NaN loss detected, skipping update");
      break;
    }

    const [updates, newOptState] = solver.update(grads, optState);
    model.params = applyUpdates(model.params, updates);
    optState = newOptState;
  }

  // Compute diagnostics: entropy and value loss from final params
  const { logits, values } = model.forward(tree.ref(model.params), statesTensor.ref);
  const maskedLogits = logits.add(masksTensor.ref.sub(1).mul(1e9));
  const diagLogProbs = nn.logSoftmax(maskedLogits);
  const diagProbs = np.exp(diagLogProbs.ref);
  const entropy = np.mean(np.sum(diagProbs.mul(diagLogProbs).mul(-1), [-1]));
  const valueLoss = np.mean(np.square(values.sub(returnsTensor.ref)));

  const [entropyVal, valueLossVal] = await Promise.all([
    entropy.data() as Promise<Float32Array>,
    valueLoss.data() as Promise<Float32Array>,
  ]);

  // Dispose data tensors
  statesTensor.dispose();
  masksTensor.dispose();
  actionsTensor.dispose();
  oldLogProbsTensor.dispose();
  advantagesTensor.dispose();
  returnsTensor.dispose();

  return {
    loss: lastLoss,
    entropy: entropyVal[0],
    valueLoss: valueLossVal[0],
    optState,
  };
}

// ============================================================
// Main training loop
// ============================================================

export async function train(model: Model, config: TrainConfig = DEFAULT_CONFIG): Promise<void> {
  console.log("=== PPO Training ===");
  console.log(`Config: ${JSON.stringify(config, null, 2)}`);
  console.log(`State size: ${STATE_SIZE}, Action size: ${ACTION_SIZE}`);
  console.log();

  // Reset JIT caches for fresh model
  _inferFn = null;
  _lossAndGradFn = null;

  const solver = adam(config.lr);
  let optState = solver.init(tree.ref(model.params));
  let seedBase = 0;

  for (let batch = 0; batch < config.totalBatches; batch++) {
    const batchStart = performance.now();

    const { games, stats } = await generateBatch(model, config, seedBase);
    seedBase += config.batchGames;
    const genTime = performance.now() - batchStart;

    const updateStart = performance.now();
    const result = await ppoUpdate(model, games, config, solver, optState);
    optState = result.optState;
    const updateTime = performance.now() - updateStart;

    if (batch % config.logInterval === 0) {
      console.log(
        `Batch ${batch}/${config.totalBatches} | ` +
        `Loss: ${result.loss.toFixed(4)} | ` +
        `Entropy: ${result.entropy.toFixed(3)} | ` +
        `VLoss: ${result.valueLoss.toFixed(4)} | ` +
        `Steps: ${stats.totalSteps} | ` +
        `Avg steps/game: ${stats.avgStepsPerGame.toFixed(1)} | ` +
        `Gen: ${(genTime / 1000).toFixed(1)}s | ` +
        `Update: ${(updateTime / 1000).toFixed(1)}s`
      );
    }

    // Save checkpoint
    const ckptDir = config.checkpointDir;
    const ckptInterval = config.checkpointInterval ?? 100;
    if (ckptDir && (batch % ckptInterval === 0 || batch === config.totalBatches - 1)) {
      await saveCheckpoint(model.params, ckptDir, `batch-${batch}`, {
        networkConfig: config.networkConfig,
        batch,
      });
      // Also save as "latest" for easy loading
      await saveCheckpoint(model.params, ckptDir, "latest", {
        networkConfig: config.networkConfig,
        batch,
      });
    }
  }

  console.log("\nTraining complete.");
}
