/**
 * Benchmark breakdown: where is time spent in generation?
 */

import { init, defaultDevice, numpy as np, nn, random, jit, tree } from "@jax-js/jax";
import { createModel, SMALL_CONFIG } from "./network.ts";
import { Environment } from "./environment.ts";
import { STATE_SIZE, ACTION_SIZE, encodeState, legalActionMask } from "./encode.ts";

const devices = await init();
defaultDevice(devices.includes("webgpu") ? "webgpu" : "wasm");
console.log("Device:", devices.includes("webgpu") ? "WebGPU" : "Wasm");

const model = createModel(SMALL_CONFIG, 42);
const GAMES = 256;

// 1. Pure CPU: observe + step with first-legal-action (no GPU at all)
{
  const envs = Array.from({ length: GAMES }, (_, i) => new Environment(i));
  const active = new Set(envs.map((_, i) => i));

  const start = performance.now();
  let steps = 0;
  while (active.size > 0) {
    for (const g of [...active]) {
      const obs = envs[g].observe();
      let action = -1;
      for (let i = 0; i < obs.legalMask.length; i++) {
        if (obs.legalMask[i] > 0.5) { action = i; break; }
      }
      if (action === -1) { envs[g].forceSkipAbility(); continue; }
      envs[g].step(action, { state: obs.state, legalMask: obs.legalMask });
      steps++;
      if (envs[g].isDone()) active.delete(g);
    }
  }
  const elapsed = performance.now() - start;
  console.log(`\n1. CPU only (observe+step):  ${elapsed.toFixed(0)}ms for ${steps} steps`);
}

// 2. Just the observe() calls (encode state + legal mask)
{
  const env = new Environment(999);
  const ITERS = 10000;
  const start = performance.now();
  for (let i = 0; i < ITERS; i++) {
    env.observe();
  }
  const elapsed = performance.now() - start;
  console.log(`2. observe() only:          ${elapsed.toFixed(0)}ms for ${ITERS} calls (${(elapsed/ITERS*1000).toFixed(0)}µs each)`);
}

// 3. GPU forward + sample (the full infer function, fixed batch)
{
  const inferFn = jit((params: any, states: any, masks: any, rngKey: any) => {
    const { logits, values } = model.forward(params, states);
    const maskedLogits = logits.add(masks.ref.sub(1).mul(1e9));
    const actions = random.categorical(rngKey, maskedLogits.ref);
    const logProbs = nn.logSoftmax(maskedLogits);
    const oneHot = nn.oneHot(actions.ref, ACTION_SIZE);
    const selectedLogProbs = np.clip(np.sum(logProbs.mul(oneHot), [-1]), -20, 0);
    return [actions, selectedLogProbs, values];
  });

  const statesBuf = new Float32Array(GAMES * STATE_SIZE);
  const masksBuf = new Float32Array(GAMES * ACTION_SIZE);
  // Fill with some valid data
  for (let i = 0; i < GAMES; i++) masksBuf[i * ACTION_SIZE] = 1;

  const statesTensor = np.array(statesBuf).reshape([GAMES, STATE_SIZE]);
  const masksTensor = np.array(masksBuf).reshape([GAMES, ACTION_SIZE]);

  // Warmup (includes JIT compilation)
  for (let i = 0; i < 3; i++) {
    const k = random.key(i);
    const [a, lp, v] = inferFn(tree.ref(model.params), statesTensor.ref, masksTensor.ref, k);
    await Promise.all([a.data(), lp.data(), v.data()]);
  }

  const ITERS = 100;
  const start = performance.now();
  for (let i = 0; i < ITERS; i++) {
    const k = random.key(1000 + i);
    const [a, lp, v] = inferFn(tree.ref(model.params), statesTensor.ref, masksTensor.ref, k);
    await Promise.all([a.data(), lp.data(), v.data()]);
  }
  const elapsed = performance.now() - start;
  console.log(`3. GPU infer+sample+read:   ${elapsed.toFixed(0)}ms for ${ITERS} calls (${(elapsed/ITERS).toFixed(1)}ms each)`);

  statesTensor.dispose();
  masksTensor.dispose();
}

// 4. GPU tensor creation from Float32Array (the CPU→GPU upload cost)
{
  const buf = new Float32Array(GAMES * STATE_SIZE);
  // Warmup
  for (let i = 0; i < 3; i++) {
    const t = np.array(buf).reshape([GAMES, STATE_SIZE]);
    t.dispose();
  }

  const ITERS = 100;
  const start = performance.now();
  for (let i = 0; i < ITERS; i++) {
    const t = np.array(buf).reshape([GAMES, STATE_SIZE]);
    t.dispose();
  }
  const elapsed = performance.now() - start;
  console.log(`4. Tensor upload (${GAMES}×${STATE_SIZE}): ${elapsed.toFixed(0)}ms for ${ITERS} calls (${(elapsed/ITERS).toFixed(1)}ms each)`);
}

// 5. GPU readback only (small: 256 ints + 256 floats + 256 floats)
{
  const a = np.zeros([GAMES], { dtype: np.int32 });
  const b = np.zeros([GAMES]);
  const c = np.zeros([GAMES]);

  // Warmup
  await Promise.all([a.ref.data(), b.ref.data(), c.ref.data()]);

  const ITERS = 100;
  const tensors: any[] = [];
  for (let i = 0; i < ITERS; i++) {
    tensors.push([np.zeros([GAMES], { dtype: np.int32 }), np.zeros([GAMES]), np.zeros([GAMES])]);
  }

  const start = performance.now();
  for (let i = 0; i < ITERS; i++) {
    const [x, y, z] = tensors[i];
    await Promise.all([x.data(), y.data(), z.data()]);
  }
  const elapsed = performance.now() - start;
  console.log(`5. GPU readback (3×${GAMES}):    ${elapsed.toFixed(0)}ms for ${ITERS} calls (${(elapsed/ITERS).toFixed(1)}ms each)`);
}

// 6. Full generation simulation: observe + upload + infer + readback + step
console.log(`\n--- Estimated per-round cost (${GAMES} games) ---`);
