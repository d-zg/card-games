/**
 * Bot: a trained neural network that plays Air, Land & Sea.
 *
 * Standalone module — depends only on jax-js, the shared game types,
 * and the encoding. No training code dependencies.
 *
 * Usage:
 *   const bot = await Bot.load("./checkpoints", "latest");
 *   const action = await bot.selectAction(view);
 */

import { init, defaultDevice, numpy as np, nn, random, tree } from "@jax-js/jax";
import type { ALSView, ALSAction } from "@card-games/shared/games/air-land-sea/types.ts";
import {
  encodeState, legalActionMask, decodeAction,
  STATE_SIZE, ACTION_SIZE,
} from "./encode.ts";
import { loadCheckpoint } from "./save-load.ts";

export interface BotOptions {
  /** "greedy" picks the best action, "sample" samples from the distribution. */
  mode: "greedy" | "sample";
  /** Temperature for sampling mode (lower = more deterministic). Default 1.0. */
  temperature?: number;
}

const DEFAULT_OPTIONS: BotOptions = { mode: "greedy" };

export class Bot {
  private params: Record<string, any>;
  private numTrunkLayers: number;

  private constructor(params: Record<string, any>, numTrunkLayers: number) {
    this.params = params;
    this.numTrunkLayers = numTrunkLayers;
  }

  /** Load a bot from a saved checkpoint. */
  static async load(dir: string, name: string): Promise<Bot> {
    const { params, meta } = await loadCheckpoint(dir, name);
    const hiddenLayers = meta.networkConfig?.hiddenLayers ?? [];
    return new Bot(params, hiddenLayers.length);
  }

  /** Create a bot from in-memory params (e.g., during training). */
  static fromParams(params: Record<string, any>, numTrunkLayers: number): Bot {
    return new Bot(params, numTrunkLayers);
  }

  /** Forward pass through the network. */
  private forward(statesTensor: any): { logits: any; values: any } {
    let x = statesTensor;
    for (let i = 0; i < this.numTrunkLayers; i++) {
      x = nn.relu(np.dot(x, this.params[`w${i}`].ref).add(this.params[`b${i}`].ref));
    }
    const logits = np.dot(x.ref, this.params.pw.ref).add(this.params.pb.ref);
    const values = np.tanh(np.dot(x, this.params.vw.ref).add(this.params.vb.ref)).reshape([-1]);
    return { logits, values };
  }

  /**
   * Select an action given a game view.
   * This is the main entry point for gameplay integration.
   */
  async selectAction(view: ALSView, options: BotOptions = DEFAULT_OPTIONS): Promise<ALSAction> {
    const state = encodeState(view);
    const mask = legalActionMask(view);

    // Check there's at least one legal action
    let hasLegal = false;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] > 0.5) { hasLegal = true; break; }
    }
    if (!hasLegal) {
      throw new Error("No legal actions available");
    }

    const stateT = np.array(state).reshape([1, STATE_SIZE]);
    const maskT = np.array(mask).reshape([1, ACTION_SIZE]);

    const { logits } = this.forward(stateT);
    const maskedLogits = logits.add(maskT.sub(1).mul(1e9));

    let actionIdx: number;

    if (options.mode === "greedy") {
      const action = np.argmax(maskedLogits.reshape([-1]), -1);
      actionIdx = ((await action.data()) as Int32Array)[0];
    } else {
      // Sample with temperature
      const temp = options.temperature ?? 1.0;
      const scaled = temp !== 1.0 ? maskedLogits.mul(1 / temp) : maskedLogits;
      const key = random.key(Math.floor(Math.random() * 2147483647));
      const action = random.categorical(key, scaled.reshape([-1]));
      actionIdx = ((await action.data()) as Int32Array)[0];
    }

    // Safety: verify the action is legal
    if (actionIdx < 0 || actionIdx >= ACTION_SIZE || mask[actionIdx] < 0.5) {
      // Fallback to first legal action
      for (let i = 0; i < ACTION_SIZE; i++) {
        if (mask[i] > 0.5) { actionIdx = i; break; }
      }
    }

    return decodeAction(actionIdx);
  }

  /**
   * Get the value estimate for a position (how likely the viewing player is to win).
   * Returns a number in [-1, 1].
   */
  async evaluate(view: ALSView): Promise<number> {
    const state = encodeState(view);
    const stateT = np.array(state).reshape([1, STATE_SIZE]);
    const { values } = this.forward(stateT);
    const val = ((await values.data()) as Float32Array)[0];
    return val;
  }
}
