/**
 * Neural network for Air, Land & Sea.
 *
 * MLP with shared trunk → policy head + value head.
 * Follows jax-js idioms: flat param pytree, nn module, jit'd forward.
 */

import { numpy as np, nn, random, jit, tree } from "@jax-js/jax";
import type { Model, Params } from "./train.ts";
import { STATE_SIZE, ACTION_SIZE } from "./encode.ts";

// ============================================================
// Network architecture config
// ============================================================

export interface NetworkConfig {
  hiddenLayers: number[];
}

export const SMALL_CONFIG: NetworkConfig = {
  hiddenLayers: [256, 128],
};

export const MEDIUM_CONFIG: NetworkConfig = {
  hiddenLayers: [512, 512, 256],
};

export const LARGE_CONFIG: NetworkConfig = {
  hiddenLayers: [1024, 1024, 512, 512],
};

// ============================================================
// Parameter initialization
// ============================================================

/** Create flat params: w1, b1, w2, b2, ..., pw, pb (policy), vw, vb (value). */
export function initParams(config: NetworkConfig, seed = 0): Params {
  const keys = random.split(random.key(seed), (config.hiddenLayers.length + 2) * 2);
  const params: Params = {};
  let ki = 0;

  // Trunk layers
  let inSize = STATE_SIZE;
  for (let i = 0; i < config.hiddenLayers.length; i++) {
    const outSize = config.hiddenLayers[i];
    const scale = 1 / Math.sqrt(inSize);
    params[`w${i}`] = random.uniform(keys.ref.slice(ki), [inSize, outSize], { minval: -scale, maxval: scale });
    ki++;
    params[`b${i}`] = random.uniform(keys.ref.slice(ki), [outSize], { minval: -scale, maxval: scale });
    ki++;
    inSize = outSize;
  }

  // Policy head (small init for near-uniform starting policy)
  params.pw = random.normal(keys.ref.slice(ki), [inSize, ACTION_SIZE]).mul(0.01);
  ki++;
  params.pb = np.zeros([ACTION_SIZE]);

  // Value head
  const vScale = 1 / Math.sqrt(inSize);
  params.vw = random.uniform(keys.ref.slice(ki), [inSize, 1], { minval: -vScale, maxval: vScale });
  ki++;
  params.vb = np.zeros([1]);

  return params;
}

// ============================================================
// Forward pass
// ============================================================

/** Number of trunk layers — set when creating the model. */
let _numTrunkLayers = 0;

const forward = jit((params: Params, states: any): { logits: any; values: any } => {
  let x = states;
  for (let i = 0; i < _numTrunkLayers; i++) {
    x = nn.relu(np.dot(x, params[`w${i}`]).add(params[`b${i}`]));
  }

  const logits = np.dot(x.ref, params.pw).add(params.pb);
  const values = np.tanh(np.dot(x, params.vw).add(params.vb)).reshape([-1]);

  return { logits, values };
});

// ============================================================
// Model factory
// ============================================================

export function createModel(config: NetworkConfig = SMALL_CONFIG, seed = 0): Model {
  _numTrunkLayers = config.hiddenLayers.length;
  return {
    params: initParams(config, seed),
    forward,
  };
}

/** Count total parameters in the model. */
export function countParams(params: Params): number {
  let total = 0;
  for (const leaf of tree.leaves(params)) {
    total += leaf.shape.reduce((a: number, b: number) => a * b, 1);
  }
  return total;
}
