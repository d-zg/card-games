/**
 * Overfitting test: can the network memorize a single small batch?
 * If loss doesn't drop to near zero, something is wrong with the setup.
 */

import { init, defaultDevice, numpy as np, nn, random, valueAndGrad, jit, tree } from "@jax-js/jax";
import { adam, applyUpdates } from "@jax-js/optax";
import { Environment } from "./environment.ts";
import { createModel, countParams, SMALL_CONFIG } from "./network.ts";
import { STATE_SIZE, ACTION_SIZE, encodeState, legalActionMask, decodeAction } from "./encode.ts";
import { playGame, randomAction } from "./environment.ts";

const devices = await init();
defaultDevice(devices.includes("webgpu") ? "webgpu" : "wasm");

const model = createModel(SMALL_CONFIG, 42);
console.log(`Parameters: ${countParams(model.params).toLocaleString()}`);

// Generate a small fixed batch of trajectories using random play
const NUM_GAMES = 32;
console.log(`\nGenerating ${NUM_GAMES} games with random play...`);

interface StepData {
  state: Float32Array;
  legalMask: Float32Array;
  action: number;
  reward: number;
}

const steps: StepData[] = [];
for (let i = 0; i < NUM_GAMES; i++) {
  const traj = playGame(i, randomAction);
  for (let s = 0; s < traj.steps.length; s++) {
    steps.push({
      state: traj.steps[s].state,
      legalMask: traj.steps[s].legalMask,
      action: traj.steps[s].actionIndex,
      reward: traj.rewards[s],
    });
  }
}
console.log(`Collected ${steps.length} steps`);

// Pack into tensors (fixed, reused every epoch)
const n = steps.length;
const statesBuf = new Float32Array(n * STATE_SIZE);
const masksBuf = new Float32Array(n * ACTION_SIZE);
const actionsBuf = new Float32Array(n * ACTION_SIZE);
const returnsBuf = new Float32Array(n);

for (let i = 0; i < n; i++) {
  statesBuf.set(steps[i].state, i * STATE_SIZE);
  masksBuf.set(steps[i].legalMask, i * ACTION_SIZE);
  actionsBuf[i * ACTION_SIZE + steps[i].action] = 1;
  returnsBuf[i] = steps[i].reward;
}

const statesTensor = np.array(statesBuf).reshape([n, STATE_SIZE]);
const masksTensor = np.array(masksBuf).reshape([n, ACTION_SIZE]);
const actionsTensor = np.array(actionsBuf).reshape([n, ACTION_SIZE]);
const returnsTensor = np.array(returnsBuf);

// Simple supervised loss: can the network predict the correct action + value?
function maskedSoftmax(logits: any, mask: any): any {
  return nn.softmax(logits.add(mask.sub(1).mul(1e9)));
}

const lossAndGrad = jit(valueAndGrad(
  (params: any, states: any, masks: any, actionOneHots: any, returns: any) => {
    const { logits, values } = model.forward(params, states);

    // Policy loss: cross-entropy with the actions taken
    const probs = maskedSoftmax(logits, masks);
    const logProbs = np.log(np.maximum(probs, np.array(1e-8)));
    const policyLoss = np.mean(np.sum(logProbs.mul(actionOneHots), [-1])).mul(-1);

    // Value loss: MSE to actual returns
    const valueLoss = np.mean(np.square(values.sub(returns)));

    return policyLoss.add(valueLoss);
  },
));

// Train: many epochs on the same data
const solver = adam(1e-3);  // high LR for overfitting
let optState = solver.init(tree.ref(model.params));

console.log("\nOverfitting on fixed batch...\n");

for (let epoch = 0; epoch < 200; epoch++) {
  const [loss, grads] = lossAndGrad(
    tree.ref(model.params),
    statesTensor.ref, masksTensor.ref, actionsTensor.ref, returnsTensor.ref,
  );

  const lossVal = ((await loss.data()) as Float32Array)[0];

  const [updates, newOptState] = solver.update(grads, optState);
  model.params = applyUpdates(model.params, updates);
  optState = newOptState;

  if (epoch % 20 === 0 || epoch === 199) {
    // Check: what fraction of actions does the network predict correctly?
    const { logits, values } = model.forward(tree.ref(model.params), statesTensor.ref);
    const maskedLogits = logits.add(masksTensor.ref.sub(1).mul(1e9));

    const predActions = np.argmax(maskedLogits, -1);
    const trueActions = np.argmax(actionsTensor.ref, -1);

    const predData = await predActions.data() as Int32Array;
    const trueData = await trueActions.data() as Int32Array;
    const valuesData = await values.data() as Float32Array;

    let correct = 0;
    for (let i = 0; i < n; i++) {
      if (predData[i] === trueData[i]) correct++;
    }

    // Check value predictions
    let valueErr = 0;
    for (let i = 0; i < n; i++) {
      valueErr += Math.abs(valuesData[i] - returnsBuf[i]);
    }

    console.log(
      `Epoch ${epoch}: loss=${lossVal.toFixed(4)}, ` +
      `action_acc=${(correct/n*100).toFixed(1)}%, ` +
      `avg_value_err=${(valueErr/n).toFixed(3)}`
    );
  }
}
