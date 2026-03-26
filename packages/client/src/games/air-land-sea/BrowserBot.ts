/**
 * Browser-side bot: loads model weights via fetch, runs inference with jax-js.
 *
 * Implements the BotPlayer interface from LocalGameController.
 */

import { init, defaultDevice, numpy as np, nn, random, tree } from "@jax-js/jax";
import type { ALSView, ALSAction } from "@card-games/shared/src/games/air-land-sea/types.js";
import type { BotPlayer } from "@card-games/shared/src/games/air-land-sea/local-game-controller.js";
import { ALL_CARDS } from "@card-games/shared/src/games/air-land-sea/cards.js";

// Inline the encoding logic to avoid importing from the ai package.
// This is a simplified version of encode.ts that works in the browser.

const CARD_IDS = ALL_CARDS.map((c) => c.id);
const NUM_CARDS = CARD_IDS.length;
const CARD_INDEX = new Map(CARD_IDS.map((id, i) => [id, i]));
const THEATERS = ["air", "land", "sea"] as const;
const STATE_SIZE = 269;
const ACTION_SIZE = 186;

// Pre-build action table (same as encode.ts)
type Theater = "air" | "land" | "sea";
type PlayerId = "player-0" | "player-1";
const PLAYERS: PlayerId[] = ["player-0", "player-1"];
const MAX_STACK = 4;

interface AnyAction { type: string; [key: string]: any }

const ACTION_TABLE: AnyAction[] = [];
// Play actions
for (const cardId of CARD_IDS) {
  for (const theater of THEATERS) {
    for (const faceUp of [true, false]) {
      ACTION_TABLE.push({ type: "play", cardId, theater, faceUp });
    }
  }
}
ACTION_TABLE.push({ type: "withdraw" });
ACTION_TABLE.push({ type: "start-next-round" });
for (const theater of THEATERS) {
  for (const cardOwner of PLAYERS) {
    for (let cardIndex = 0; cardIndex < MAX_STACK; cardIndex++) {
      ACTION_TABLE.push({ type: "choose-flip", theater, cardOwner, cardIndex });
    }
  }
}
for (const fromTheater of THEATERS) {
  for (let cardIndex = 0; cardIndex < MAX_STACK; cardIndex++) {
    for (const toTheater of THEATERS) {
      if (toTheater !== fromTheater) {
        ACTION_TABLE.push({ type: "choose-transport", fromTheater, cardIndex, toTheater });
      }
    }
  }
}
for (const theater of THEATERS) {
  ACTION_TABLE.push({ type: "choose-reinforce", play: true, theater });
}
ACTION_TABLE.push({ type: "choose-reinforce", play: false });
for (const theater of THEATERS) {
  for (let cardIndex = 0; cardIndex < MAX_STACK; cardIndex++) {
    ACTION_TABLE.push({ type: "choose-redeploy", theater, cardIndex });
  }
}
for (const theater of THEATERS) {
  for (let cardIndex = 0; cardIndex < MAX_STACK; cardIndex++) {
    ACTION_TABLE.push({ type: "choose-disrupt-flip", theater, cardIndex });
  }
}

function encodeState(view: ALSView): Float32Array {
  const buf = new Float32Array(STATE_SIZE);
  const me = view.myPlayerId!;
  const opp: PlayerId = me === "player-0" ? "player-1" : "player-0";
  let offset = 0;

  const handSet = new Set(view.myHand);
  for (let i = 0; i < NUM_CARDS; i++) {
    buf[offset + i] = handSet.has(CARD_IDS[i]) ? 1 : 0;
  }
  offset += NUM_CARDS;

  const cardLocations = new Map<string, { side: "my" | "opp"; theater: Theater; faceUp: boolean }>();
  const oppFaceDownCounts: Record<Theater, number> = { air: 0, land: 0, sea: 0 };

  for (const theater of THEATERS) {
    for (const card of view.theaters[theater].stacks[me]) {
      if (card.cardId) cardLocations.set(card.cardId, { side: "my", theater, faceUp: card.faceUp });
    }
    for (const card of view.theaters[theater].stacks[opp]) {
      if (card.cardId) cardLocations.set(card.cardId, { side: "opp", theater, faceUp: card.faceUp });
      else oppFaceDownCounts[theater]++;
    }
  }

  const theaterFeatureOffset: Record<Theater, number> = { air: 0, land: 2, sea: 4 };
  const oppTheaterFeatureOffset: Record<Theater, number> = { air: 7, land: 8, sea: 9 };

  for (let i = 0; i < NUM_CARDS; i++) {
    const cardId = CARD_IDS[i];
    const base = offset + i * 11;
    if (handSet.has(cardId)) {
      buf[base + 0] = 1;
    } else {
      const loc = cardLocations.get(cardId);
      if (loc) {
        if (loc.side === "my") {
          buf[base + 1 + theaterFeatureOffset[loc.theater] + (loc.faceUp ? 0 : 1)] = 1;
        } else {
          buf[base + oppTheaterFeatureOffset[loc.theater]] = 1;
        }
      } else {
        buf[base + 10] = 1;
      }
    }
  }
  offset += NUM_CARDS * 11;

  for (const theater of THEATERS) buf[offset++] = oppFaceDownCounts[theater] / 6;
  for (const theater of THEATERS) buf[offset++] = (view.theaterStrengths[theater]?.[me] ?? 0) / 30;
  for (const theater of THEATERS) buf[offset++] = (view.theaterStrengths[theater]?.[opp] ?? 0) / 30;
  buf[offset++] = (view.scores[me] ?? 0) / 12;
  buf[offset++] = (view.scores[opp] ?? 0) / 12;
  buf[offset++] = view.currentPlayer === me ? 1 : 0;
  buf[offset++] = view.isFirstPlayer ? 1 : 0;
  buf[offset++] = view.airDropActive ? 1 : 0;
  buf[offset++] = view.aerodromeActive ? 1 : 0;
  buf[offset++] = view.opponentHandSize / 6;

  for (let slot = 0; slot < 3; slot++) {
    const t = view.theaterOrder[slot];
    buf[offset++] = t === "air" ? 1 : 0;
    buf[offset++] = t === "land" ? 1 : 0;
  }

  const abilityTypes = ["none", "maneuver", "ambush", "transport", "reinforce", "redeploy", "disrupt-opponent", "disrupt-self"];
  const abilityType = view.pendingAbility?.type ?? "none";
  for (const t of abilityTypes) buf[offset++] = abilityType === t ? 1 : 0;

  const pending = view.pendingAbility;
  if (pending && "adjacentTheaters" in pending) {
    const adj = (pending as any).adjacentTheaters as Theater[];
    for (const theater of THEATERS) buf[offset++] = adj.includes(theater) ? 1 : 0;
  } else {
    offset += 3;
  }

  if (pending?.type === "reinforce" && (pending as any).topCard) {
    const cardIdx = CARD_INDEX.get((pending as any).topCard);
    if (cardIdx !== undefined) buf[offset + cardIdx] = 1;
  }
  offset += NUM_CARDS;

  buf[offset++] = view.phase === "round-over" ? 1 : 0;
  buf[offset++] = view.roundNumber / 10;

  return buf;
}

function legalActionMask(view: ALSView): Float32Array {
  const mask = new Float32Array(ACTION_SIZE);
  const me = view.myPlayerId!;
  const opp: PlayerId = me === "player-0" ? "player-1" : "player-0";

  if (view.phase === "game-over") return mask;
  if (view.phase === "round-over") {
    mask[108 + 1] = 1; // start-next-round index
    return mask;
  }

  if (view.pendingAbility) {
    if (view.pendingAbility.playerId !== me) return mask;
    return abilityMask(view, mask, me, opp);
  }

  if (view.currentPlayer !== me) return mask;
  mask[108] = 1; // withdraw

  for (const cardId of view.myHand) {
    const card = ALL_CARDS[CARD_INDEX.get(cardId)!];
    for (let ti = 0; ti < 3; ti++) {
      const theater = THEATERS[ti];
      // face-down always legal
      const fdIdx = CARD_IDS.indexOf(cardId) * 6 + ti * 2 + 1;
      mask[fdIdx] = 1;
      // face-up
      const canOff = view.airDropActive || (card.strength <= 3 && view.aerodromeActive);
      if (card.theater === theater || canOff) {
        mask[fdIdx - 1] = 1;
      }
    }
  }
  return mask;
}

function abilityMask(view: ALSView, mask: Float32Array, me: PlayerId, opp: PlayerId): Float32Array {
  const pending = view.pendingAbility!;
  const base = 110; // after play(108) + withdraw(1) + start-next-round(1)

  switch (pending.type) {
    case "maneuver": {
      const adj = (pending as any).adjacentTheaters as Theater[];
      for (const theater of adj) {
        for (let oi = 0; oi < 2; oi++) {
          const owner = PLAYERS[oi];
          const stack = view.theaters[theater].stacks[owner];
          if (stack.length > 0 && stack.length - 1 < MAX_STACK) {
            const idx = base + THEATERS.indexOf(theater) * 8 + oi * 4 + (stack.length - 1);
            mask[idx] = 1;
          }
        }
      }
      break;
    }
    case "ambush": {
      for (let ti = 0; ti < 3; ti++) {
        for (let oi = 0; oi < 2; oi++) {
          const stack = view.theaters[THEATERS[ti]].stacks[PLAYERS[oi]];
          if (stack.length > 0 && stack.length - 1 < MAX_STACK) {
            const idx = base + ti * 8 + oi * 4 + (stack.length - 1);
            mask[idx] = 1;
          }
        }
      }
      break;
    }
    case "transport": {
      const tBase = base + 24;
      for (let fi = 0; fi < 3; fi++) {
        const stack = view.theaters[THEATERS[fi]].stacks[me];
        for (let ci = 0; ci < stack.length && ci < MAX_STACK; ci++) {
          let subIdx = 0;
          for (let ti = 0; ti < 3; ti++) {
            if (ti !== fi) {
              mask[tBase + fi * 8 + ci * 2 + subIdx] = 1;
              subIdx++;
            }
          }
        }
      }
      break;
    }
    case "reinforce": {
      const rBase = base + 24 + 24;
      mask[rBase + 3] = 1; // decline
      for (const theater of (pending as any).adjacentTheaters as Theater[]) {
        mask[rBase + THEATERS.indexOf(theater)] = 1;
      }
      break;
    }
    case "redeploy": {
      const dBase = base + 24 + 24 + 4;
      for (let ti = 0; ti < 3; ti++) {
        const stack = view.theaters[THEATERS[ti]].stacks[me];
        for (let ci = 0; ci < stack.length && ci < MAX_STACK; ci++) {
          if (!stack[ci].faceUp) mask[dBase + ti * 4 + ci] = 1;
        }
      }
      break;
    }
    case "disrupt-opponent":
    case "disrupt-self": {
      const disBase = base + 24 + 24 + 4 + 12;
      for (let ti = 0; ti < 3; ti++) {
        const stack = view.theaters[THEATERS[ti]].stacks[me];
        if (stack.length > 0 && stack.length - 1 < MAX_STACK) {
          mask[disBase + ti * 4 + (stack.length - 1)] = 1;
        }
      }
      break;
    }
  }
  return mask;
}

// ============================================================
// Checkpoint loading
// ============================================================

interface ParamMeta {
  key: string;
  shape: number[];
  dtype: string;
  byteOffset: number;
  byteLength: number;
}

interface CheckpointMeta {
  params: ParamMeta[];
  totalBytes: number;
  networkConfig: { hiddenLayers: number[] };
}

// ============================================================
// BrowserBot
// ============================================================

export class BrowserBot implements BotPlayer {
  private params: Record<string, any>;
  private numTrunkLayers: number;
  private ready = false;

  private constructor(params: Record<string, any>, numTrunkLayers: number) {
    this.params = params;
    this.numTrunkLayers = numTrunkLayers;
    this.ready = true;
  }

  /** Load bot from static model files. Call after jax-js init. */
  static async load(basePath: string, name: string): Promise<BrowserBot> {
    const metaResp = await fetch(`${basePath}/${name}.meta.json`);
    const meta: CheckpointMeta = await metaResp.json();

    const weightsResp = await fetch(`${basePath}/${name}.weights.bin`);
    const allBytes = new Uint8Array(await weightsResp.arrayBuffer());

    const params: Record<string, any> = {};
    for (const pm of meta.params) {
      const slice = allBytes.slice(pm.byteOffset, pm.byteOffset + pm.byteLength);
      const typedArray = pm.dtype === "float32"
        ? new Float32Array(slice.buffer, slice.byteOffset, slice.byteLength / 4)
        : new Int32Array(slice.buffer, slice.byteOffset, slice.byteLength / 4);
      params[pm.key] = np.array(typedArray).reshape(pm.shape);
    }

    return new BrowserBot(params, meta.networkConfig.hiddenLayers.length);
  }

  async selectAction(view: ALSView): Promise<ALSAction> {
    const state = encodeState(view);
    const mask = legalActionMask(view);

    const stateT = np.array(state).reshape([1, STATE_SIZE]);
    const maskT = np.array(mask).reshape([1, ACTION_SIZE]);

    // Forward pass
    let x: any = stateT;
    for (let i = 0; i < this.numTrunkLayers; i++) {
      x = nn.relu(np.dot(x, this.params[`w${i}`].ref).add(this.params[`b${i}`].ref));
    }
    const logits = np.dot(x, this.params.pw.ref).add(this.params.pb.ref);
    const maskedLogits = logits.add(maskT.sub(1).mul(1e9));

    // Greedy: pick highest logit
    const actionT = np.argmax(maskedLogits.reshape([-1]), -1);
    let actionIdx = ((await actionT.data()) as Int32Array)[0];

    // Safety check
    if (actionIdx < 0 || actionIdx >= ACTION_SIZE || mask[actionIdx] < 0.5) {
      for (let i = 0; i < ACTION_SIZE; i++) {
        if (mask[i] > 0.5) { actionIdx = i; break; }
      }
    }

    return ACTION_TABLE[actionIdx] as ALSAction;
  }
}

/** Initialize jax-js for browser use. Returns the available devices. */
export async function initJax(): Promise<string[]> {
  const devices = await init();
  if (devices.includes("webgpu")) {
    defaultDevice("webgpu");
  } else if (devices.includes("wasm")) {
    defaultDevice("wasm");
  }
  return devices;
}
