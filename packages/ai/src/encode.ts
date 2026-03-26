/**
 * State and action encoding for Air, Land & Sea.
 *
 * State encoding converts an ALSView into a fixed-size float array
 * that a neural network can consume. Action encoding maps between
 * ALSAction objects and integer indices.
 */

import type { ALSView, ALSAction, Theater, PlayedCardView } from "@card-games/shared/games/air-land-sea/types.ts";
import { ALL_CARDS } from "@card-games/shared/games/air-land-sea/cards.ts";
import type { PlayerId } from "@card-games/shared/types.ts";

const THEATERS: Theater[] = ["air", "land", "sea"];
const CARD_IDS = ALL_CARDS.map((c) => c.id);
const NUM_CARDS = CARD_IDS.length; // 18
const CARD_INDEX = new Map(CARD_IDS.map((id, i) => [id, i]));

// ============================================================
// State encoding
// ============================================================

/**
 * Encode an ALSView into a flat float array.
 *
 * Layout:
 *   [0..17]    My hand: 1 if I hold card i, else 0
 *   [18..215]  Per-card location (18 cards × 11 features each):
 *              For each card: [in_hand, my_air_up, my_air_down, my_land_up, my_land_down,
 *                              my_sea_up, my_sea_down, opp_air_up, opp_land_up, opp_sea_up, unknown]
 *   [216..218] Opponent face-down card count per theater (air, land, sea), /6
 *   [219..224] Theater strengths: my_air, my_land, my_sea, opp_air, opp_land, opp_sea, each /30
 *   [225]      My score /12
 *   [226]      Opponent score /12
 *   [227]      Is my turn (0 or 1)
 *   [228]      Is first player (0 or 1)
 *   [229]      Air drop active (0 or 1)
 *   [230]      Aerodrome active (0 or 1)
 *   [231]      Opponent hand size /6
 *   [232..237] Theater order: 3 slots × 2 features [is_air, is_land] (sea implied)
 *   [238..245] Pending ability type one-hot: [none, maneuver, ambush, transport,
 *              reinforce, redeploy, disrupt-opponent, disrupt-self]
 *   [246..248] Pending ability adjacent theaters: [air_adjacent, land_adjacent, sea_adjacent]
 *   [249..266] Reinforce top card: 18-dim one-hot (which card was peeked), all zeros if N/A
 *   [267]      Phase: round-over (1) vs playing (0). Game-over has no legal actions so not needed.
 *   [268]      Round number /10
 *
 * Total: 269 features
 */

export const STATE_SIZE = 269;

export function encodeState(view: ALSView): Float32Array {
  const buf = new Float32Array(STATE_SIZE);
  const me = view.myPlayerId!;
  const opp: PlayerId = me === "player-0" ? "player-1" : "player-0";
  let offset = 0;

  // --- My hand (18) ---
  const handSet = new Set(view.myHand);
  for (let i = 0; i < NUM_CARDS; i++) {
    buf[offset + i] = handSet.has(CARD_IDS[i]) ? 1 : 0;
  }
  offset += NUM_CARDS; // 18

  // --- Per-card location (18 × 11 = 198) ---
  // Build lookup: cardId → location info
  // Possible locations per card from my view:
  //   in_hand, my_{theater}_{up|down}, opp_{theater}_up, unknown
  // Opponent's face-down cards have cardId=null, so they're not in this per-card map.

  // First, collect all known card positions from the board
  const cardLocations = new Map<string, { side: "my" | "opp"; theater: Theater; faceUp: boolean }>();
  const oppFaceDownCounts: Record<Theater, number> = { air: 0, land: 0, sea: 0 };

  for (const theater of THEATERS) {
    const theaterView = view.theaters[theater];
    // My stack
    for (const card of theaterView.stacks[me]) {
      if (card.cardId) {
        cardLocations.set(card.cardId, { side: "my", theater, faceUp: card.faceUp });
      }
    }
    // Opponent stack
    for (const card of theaterView.stacks[opp]) {
      if (card.cardId) {
        // Face-up opponent card (cardId is visible)
        cardLocations.set(card.cardId, { side: "opp", theater, faceUp: card.faceUp });
      } else {
        // Face-down opponent card (identity unknown)
        oppFaceDownCounts[theater]++;
      }
    }
  }

  // Feature indices within each card's 11-feature block:
  // 0: in_hand
  // 1: my_air_up, 2: my_air_down
  // 3: my_land_up, 4: my_land_down
  // 5: my_sea_up, 6: my_sea_down
  // 7: opp_air_up, 8: opp_land_up, 9: opp_sea_up
  // 10: unknown
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
          const tOff = theaterFeatureOffset[loc.theater];
          buf[base + 1 + tOff + (loc.faceUp ? 0 : 1)] = 1;
        } else {
          // Opponent face-up card
          buf[base + oppTheaterFeatureOffset[loc.theater]] = 1;
        }
      } else {
        // Card not in my hand, not visible on board → unknown
        buf[base + 10] = 1;
      }
    }
  }
  offset += NUM_CARDS * 11; // 198, total so far: 216

  // --- Opponent face-down counts per theater (3) ---
  for (const theater of THEATERS) {
    buf[offset++] = oppFaceDownCounts[theater] / 6;
  }
  // offset: 219

  // --- Theater strengths (6) ---
  for (const theater of THEATERS) {
    buf[offset++] = (view.theaterStrengths[theater]?.[me] ?? 0) / 30;
  }
  for (const theater of THEATERS) {
    buf[offset++] = (view.theaterStrengths[theater]?.[opp] ?? 0) / 30;
  }
  // offset: 225

  // --- Scores (2) ---
  buf[offset++] = (view.scores[me] ?? 0) / 12;
  buf[offset++] = (view.scores[opp] ?? 0) / 12;
  // offset: 227

  // --- Flags (5) ---
  buf[offset++] = view.currentPlayer === me ? 1 : 0;
  buf[offset++] = view.isFirstPlayer ? 1 : 0;
  buf[offset++] = view.airDropActive ? 1 : 0;
  buf[offset++] = view.aerodromeActive ? 1 : 0;
  buf[offset++] = view.opponentHandSize / 6;
  // offset: 232

  // --- Theater order (6): one-hot per slot ---
  // 3 slots × 3 possible theaters = 9? No, let's do 3 slots × 2 features.
  // Actually simplest: for each slot position (0,1,2), encode which theater is there.
  // 3 positions × 1 value each (0=air, 0.5=land, 1=sea)
  // But one-hot is better for the network. 3 slots × 2 = 6 (we can reconstruct the 3rd).
  // Actually let's just do: for each of the 6 (slot, theater) pairs, is this theater in this slot?
  // That's 9 features. But we said 6 in the layout... let me just use 6.
  // Encode as: for each slot, [is_air, is_land] (sea is implied). 3×2=6.
  for (let slot = 0; slot < 3; slot++) {
    const t = view.theaterOrder[slot];
    buf[offset++] = t === "air" ? 1 : 0;
    buf[offset++] = t === "land" ? 1 : 0;
  }
  // offset: 238

  // --- Pending ability type (8 one-hot) ---
  const abilityTypes = [
    "none", "maneuver", "ambush", "transport",
    "reinforce", "redeploy", "disrupt-opponent", "disrupt-self",
  ];
  const abilityType = view.pendingAbility?.type ?? "none";
  for (const t of abilityTypes) {
    buf[offset++] = abilityType === t ? 1 : 0;
  }
  // offset: 246

  // --- Pending ability adjacent theaters (3) ---
  const pending = view.pendingAbility;
  if (pending && "adjacentTheaters" in pending) {
    const adj = (pending as { adjacentTheaters: Theater[] }).adjacentTheaters;
    for (const theater of THEATERS) {
      buf[offset++] = adj.includes(theater) ? 1 : 0;
    }
  } else {
    offset += 3;
  }
  // offset: 249

  // --- Reinforce top card (18 one-hot) ---
  if (pending?.type === "reinforce" && pending.topCard) {
    const cardIdx = CARD_INDEX.get(pending.topCard);
    if (cardIdx !== undefined) {
      buf[offset + cardIdx] = 1;
    }
  }
  offset += NUM_CARDS;
  // offset: 267

  // --- Phase (1) ---
  buf[offset++] = view.phase === "round-over" ? 1 : 0;
  // offset: 268

  // --- Round number (1) ---
  buf[offset++] = view.roundNumber / 10;
  // offset: 269

  return buf;
}

// ============================================================
// Action encoding
// ============================================================

/**
 * Build the complete action space. Each action is assigned a unique index.
 *
 * Action categories:
 *   Play actions: 18 cards × 3 theaters × 2 (face-up/down) = 108
 *   Withdraw: 1
 *   Start next round: 1
 *   Choose-flip: 3 theaters × 2 owners × 4 max stack positions = 24
 *   Choose-transport: 3 from-theaters × 4 positions × 2 to-theaters = 24
 *   Choose-reinforce: 3 theaters + 1 decline = 4
 *   Choose-redeploy: 3 theaters × 4 positions = 12
 *   Choose-disrupt-flip: 3 theaters × 4 positions = 12
 *
 * Total: 108 + 1 + 1 + 24 + 24 + 4 + 12 + 12 = 186
 */

export const ACTION_SIZE = 186;

const MAX_STACK = 4;
const PLAYERS: PlayerId[] = ["player-0", "player-1"];

export interface ActionMapping {
  index: number;
  action: ALSAction;
}

// Pre-build the full action table
const ACTION_TABLE: ALSAction[] = [];

// Play actions: card × theater × faceUp
for (const cardId of CARD_IDS) {
  for (const theater of THEATERS) {
    for (const faceUp of [true, false]) {
      ACTION_TABLE.push({ type: "play", cardId, theater, faceUp });
    }
  }
}

// Withdraw
ACTION_TABLE.push({ type: "withdraw" });

// Start next round
ACTION_TABLE.push({ type: "start-next-round" });

// Choose-flip: theater × owner × position
for (const theater of THEATERS) {
  for (const cardOwner of PLAYERS) {
    for (let cardIndex = 0; cardIndex < MAX_STACK; cardIndex++) {
      ACTION_TABLE.push({ type: "choose-flip", theater, cardOwner, cardIndex });
    }
  }
}

// Choose-transport: fromTheater × position × toTheater
for (const fromTheater of THEATERS) {
  for (let cardIndex = 0; cardIndex < MAX_STACK; cardIndex++) {
    for (const toTheater of THEATERS) {
      if (toTheater !== fromTheater) {
        ACTION_TABLE.push({ type: "choose-transport", fromTheater, cardIndex, toTheater });
      }
    }
  }
}

// Choose-reinforce: play to theater or decline
for (const theater of THEATERS) {
  ACTION_TABLE.push({ type: "choose-reinforce", play: true, theater });
}
ACTION_TABLE.push({ type: "choose-reinforce", play: false });

// Choose-redeploy: theater × position
for (const theater of THEATERS) {
  for (let cardIndex = 0; cardIndex < MAX_STACK; cardIndex++) {
    ACTION_TABLE.push({ type: "choose-redeploy", theater, cardIndex });
  }
}

// Choose-disrupt-flip: theater × position
for (const theater of THEATERS) {
  for (let cardIndex = 0; cardIndex < MAX_STACK; cardIndex++) {
    ACTION_TABLE.push({ type: "choose-disrupt-flip", theater, cardIndex });
  }
}

// Verify size
if (ACTION_TABLE.length !== ACTION_SIZE) {
  throw new Error(`Action table size mismatch: ${ACTION_TABLE.length} !== ${ACTION_SIZE}`);
}

// Build reverse lookup for action → index
const ACTION_INDEX = new Map<string, number>();
for (let i = 0; i < ACTION_TABLE.length; i++) {
  ACTION_INDEX.set(actionKey(ACTION_TABLE[i]), i);
}

/** Deterministic string key for an action. */
function actionKey(a: ALSAction): string {
  switch (a.type) {
    case "play":
      return `play:${a.cardId}:${a.theater}:${a.faceUp}`;
    case "withdraw":
      return "withdraw";
    case "start-next-round":
      return "start-next-round";
    case "choose-flip":
      return `flip:${a.theater}:${a.cardOwner}:${a.cardIndex}`;
    case "choose-transport":
      return `transport:${a.fromTheater}:${a.cardIndex}:${a.toTheater}`;
    case "choose-reinforce":
      return `reinforce:${a.play}:${a.theater ?? "none"}`;
    case "choose-redeploy":
      return `redeploy:${a.theater}:${a.cardIndex}`;
    case "choose-disrupt-flip":
      return `disrupt:${a.theater}:${a.cardIndex}`;
  }
}

/** Get the action object for an index. */
export function decodeAction(index: number): ALSAction {
  return ACTION_TABLE[index];
}

/** Get the index for an action. Returns -1 if not found. */
export function encodeAction(action: ALSAction): number {
  return ACTION_INDEX.get(actionKey(action)) ?? -1;
}

/** Get the full action table (read-only). */
export function getActionTable(): readonly ALSAction[] {
  return ACTION_TABLE;
}

// ============================================================
// Legal action mask
// ============================================================

/**
 * Given an ALSView, return a binary mask over the action space
 * where 1 = legal, 0 = illegal.
 *
 * This uses the view to determine legality rather than calling
 * validateAction (which requires the full state). The view contains
 * enough information to reconstruct legality for the active player.
 */
export function legalActionMask(view: ALSView): Float32Array {
  const mask = new Float32Array(ACTION_SIZE);
  const me = view.myPlayerId!;
  const opp: PlayerId = me === "player-0" ? "player-1" : "player-0";

  if (view.phase === "game-over") return mask;

  if (view.phase === "round-over") {
    const idx = encodeAction({ type: "start-next-round" });
    mask[idx] = 1;
    return mask;
  }

  // Playing phase
  if (view.pendingAbility) {
    // Only ability resolution actions
    if (view.pendingAbility.playerId !== me) return mask;
    return abilityActionMask(view, mask);
  }

  if (view.currentPlayer !== me) return mask;

  // Normal turn: play or withdraw
  const handSet = new Set(view.myHand);

  // Withdraw is always legal on your turn
  mask[encodeAction({ type: "withdraw" })] = 1;

  // Play actions
  for (const cardId of view.myHand) {
    const card = ALL_CARDS[CARD_INDEX.get(cardId)!];

    for (const theater of THEATERS) {
      // Face-down: always legal to any theater
      mask[encodeAction({ type: "play", cardId, theater, faceUp: false })] = 1;

      // Face-up: must match theater, unless air drop or aerodrome
      const canPlayOffTheater =
        view.airDropActive ||
        (card.strength <= 3 && view.aerodromeActive);

      if (card.theater === theater || canPlayOffTheater) {
        mask[encodeAction({ type: "play", cardId, theater, faceUp: true })] = 1;
      }
    }
  }

  return mask;
}

function abilityActionMask(view: ALSView, mask: Float32Array): Float32Array {
  const me = view.myPlayerId!;
  const opp: PlayerId = me === "player-0" ? "player-1" : "player-0";
  const pending = view.pendingAbility!;

  switch (pending.type) {
    case "maneuver": {
      const adjacent = pending.adjacentTheaters;
      for (const theater of adjacent) {
        for (const owner of PLAYERS) {
          const stack = view.theaters[theater].stacks[owner];
          if (stack.length > 0) {
            // Can only flip the top (uncovered) card
            const topIdx = stack.length - 1;
            if (topIdx < MAX_STACK) {
              mask[encodeAction({ type: "choose-flip", theater, cardOwner: owner, cardIndex: topIdx })] = 1;
            }
          }
        }
      }
      break;
    }

    case "ambush": {
      for (const theater of THEATERS) {
        for (const owner of PLAYERS) {
          const stack = view.theaters[theater].stacks[owner];
          if (stack.length > 0) {
            const topIdx = stack.length - 1;
            if (topIdx < MAX_STACK) {
              mask[encodeAction({ type: "choose-flip", theater, cardOwner: owner, cardIndex: topIdx })] = 1;
            }
          }
        }
      }
      break;
    }

    case "transport": {
      for (const fromTheater of THEATERS) {
        const stack = view.theaters[fromTheater].stacks[me];
        for (let i = 0; i < stack.length && i < MAX_STACK; i++) {
          for (const toTheater of THEATERS) {
            if (toTheater !== fromTheater) {
              mask[encodeAction({ type: "choose-transport", fromTheater, cardIndex: i, toTheater })] = 1;
            }
          }
        }
      }
      break;
    }

    case "reinforce": {
      // Decline
      mask[encodeAction({ type: "choose-reinforce", play: false })] = 1;
      // Play to adjacent theaters
      for (const theater of pending.adjacentTheaters) {
        mask[encodeAction({ type: "choose-reinforce", play: true, theater })] = 1;
      }
      break;
    }

    case "redeploy": {
      for (const theater of THEATERS) {
        const stack = view.theaters[theater].stacks[me];
        for (let i = 0; i < stack.length && i < MAX_STACK; i++) {
          if (!stack[i].faceUp) {
            mask[encodeAction({ type: "choose-redeploy", theater, cardIndex: i })] = 1;
          }
        }
      }
      break;
    }

    case "disrupt-opponent":
    case "disrupt-self": {
      // Must flip one of your own uncovered cards
      for (const theater of THEATERS) {
        const stack = view.theaters[theater].stacks[me];
        if (stack.length > 0) {
          const topIdx = stack.length - 1;
          if (topIdx < MAX_STACK) {
            mask[encodeAction({ type: "choose-disrupt-flip", theater, cardIndex: topIdx })] = 1;
          }
        }
      }
      break;
    }
  }

  return mask;
}

// ============================================================
// Debug / inspection helpers
// ============================================================

/** Human-readable summary of encoded state for debugging. */
export function describeEncoding(encoded: Float32Array): string {
  const lines: string[] = [];

  // Hand
  const hand: string[] = [];
  for (let i = 0; i < NUM_CARDS; i++) {
    if (encoded[i] > 0.5) hand.push(CARD_IDS[i]);
  }
  lines.push(`Hand: [${hand.join(", ")}]`);

  // Per-card locations
  const locations: string[] = [];
  for (let i = 0; i < NUM_CARDS; i++) {
    const base = 18 + i * 11;
    const featureNames = [
      "hand", "my_air_up", "my_air_down", "my_land_up", "my_land_down",
      "my_sea_up", "my_sea_down", "opp_air_up", "opp_land_up", "opp_sea_up", "unknown",
    ];
    for (let f = 0; f < 11; f++) {
      if (encoded[base + f] > 0.5) {
        locations.push(`  ${CARD_IDS[i]}: ${featureNames[f]}`);
      }
    }
  }
  lines.push(`Card locations:\n${locations.join("\n")}`);

  // Scores & flags
  lines.push(`My score: ${encoded[225] * 12}, Opp score: ${encoded[226] * 12}`);
  lines.push(`Is my turn: ${encoded[227] > 0.5}, Is first player: ${encoded[228] > 0.5}`);

  // Pending ability
  const abilityNames = [
    "none", "maneuver", "ambush", "transport",
    "reinforce", "redeploy", "disrupt-opponent", "disrupt-self",
  ];
  for (let i = 0; i < 8; i++) {
    if (encoded[238 + i] > 0.5) {
      lines.push(`Pending ability: ${abilityNames[i]}`);
    }
  }

  // Reinforce top card
  for (let i = 0; i < NUM_CARDS; i++) {
    if (encoded[249 + i] > 0.5) {
      lines.push(`Reinforce top card: ${CARD_IDS[i]}`);
    }
  }

  lines.push(`Phase: ${encoded[267] > 0.5 ? "round-over" : "playing"}, Round: ${Math.round(encoded[268] * 10)}`);

  return lines.join("\n");
}

/** Count how many actions are legal in a mask. */
export function countLegal(mask: Float32Array): number {
  let count = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] > 0.5) count++;
  }
  return count;
}

/** List legal actions from a mask. */
export function listLegalActions(mask: Float32Array): ALSAction[] {
  const actions: ALSAction[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] > 0.5) {
      actions.push(ACTION_TABLE[i]);
    }
  }
  return actions;
}
