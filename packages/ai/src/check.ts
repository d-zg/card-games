import { init, defaultDevice, numpy as np } from "@jax-js/jax";
import { GameRunner } from "@card-games/shared";

const devices = await init();
console.log("Available devices:", devices);

if (devices.includes("webgpu")) {
  defaultDevice("webgpu");
  console.log("Using WebGPU");
} else {
  defaultDevice("wasm");
  console.log("WebGPU not available, using Wasm");
}

const x = np.array([1, 2, 3]);
console.log("Tensor:", await x.jsAsync());

console.log("GameRunner available:", typeof GameRunner);
console.log("Setup complete!");
