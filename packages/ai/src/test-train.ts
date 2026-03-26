/**
 * Test the full training pipeline with a real network.
 */

import { init, defaultDevice } from "@jax-js/jax";
import { train, DEFAULT_CONFIG } from "./train.ts";
import { createModel, countParams, SMALL_CONFIG } from "./network.ts";

// Initialize jax-js
const devices = await init();
console.log("Available devices:", devices);

if (devices.includes("webgpu")) {
  defaultDevice("webgpu");
  console.log("Using: WebGPU");
} else {
  defaultDevice("wasm");
  console.log("WARNING: WebGPU not available, falling back to Wasm (CPU)");
}

const model = createModel(SMALL_CONFIG, 42);
console.log(`Network: ${SMALL_CONFIG.hiddenLayers.join(" → ")}`);
console.log(`Parameters: ${countParams(model.params).toLocaleString()}`);
console.log();

const testConfig = {
  ...DEFAULT_CONFIG,
  batchGames: 2048,
  totalBatches: 10,
  ppoEpochs: 2,
  logInterval: 1,
  lr: 1e-4,
  clipEps: 0.1,  // tighter clipping for stability
};

await train(model, testConfig);
