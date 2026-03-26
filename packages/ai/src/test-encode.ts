/**
 * Test script: verify state and action encoding against a real game.
 */

import { GameRunner } from "@card-games/shared";
import { alsGame } from "@card-games/shared/games/air-land-sea/index.ts";
import type { ALSState, ALSAction, ALSView } from "@card-games/shared/games/air-land-sea/types.ts";
import {
  encodeState, legalActionMask, describeEncoding,
  countLegal, listLegalActions, encodeAction, decodeAction,
  STATE_SIZE, ACTION_SIZE,
} from "./encode.ts";

const runner = new GameRunner(alsGame, 42, 2);
const state = runner.getState() as ALSState;
const view0 = runner.getView("player-0") as ALSView;
const view1 = runner.getView("player-1") as ALSView;

console.log("=== Game Setup ===");
console.log("Phase:", view0.phase);
console.log("Current player:", view0.currentPlayer);
console.log("Theater order:", view0.theaterOrder);
console.log("Player-0 hand:", view0.myHand);
console.log("Player-1 hand:", view1.myHand);
console.log();

// Encode player-0's view
console.log("=== State Encoding (player-0) ===");
const encoded0 = encodeState(view0);
console.log(`State vector size: ${encoded0.length} (expected ${STATE_SIZE})`);
console.log();
console.log(describeEncoding(encoded0));
console.log();

// Verify hand encoding matches
const handFromEncoding: string[] = [];
for (let i = 0; i < 18; i++) {
  if (encoded0[i] > 0.5) handFromEncoding.push(view0.myHand.find((_, j) => encoded0[i] > 0.5) ?? "?");
}
console.log(`Hand cards in encoding: ${handFromEncoding.length}, actual: ${view0.myHand.length}`);
console.log();

// Legal actions
console.log("=== Legal Actions (player-0) ===");
const mask0 = legalActionMask(view0);
const legalCount = countLegal(mask0);
console.log(`Legal actions: ${legalCount}`);

const legalActions = listLegalActions(mask0);
for (const a of legalActions) {
  console.log(` - ${JSON.stringify(a)}`);
}
console.log();

// Expected: 6 cards × 3 theaters × 2 (face-up/down) = 36, but face-up restricted to matching theater
// So: 6 cards × (1 face-up to matching + 3 face-down to any) = 6 × 4 = 24
// Plus withdraw = 25
// But some cards share theaters, so face-up count varies.
// Let's count manually:
let expectedPlay = 0;
for (const cardId of view0.myHand) {
  expectedPlay += 3; // face-down to any theater
  expectedPlay += 1; // face-up to matching theater
}
console.log(`Expected play actions: ${expectedPlay} + 1 withdraw = ${expectedPlay + 1}`);
console.log();

// Action encoding round-trip
console.log("=== Action Encoding Round-Trip ===");
const testAction: ALSAction = { type: "play", cardId: view0.myHand[0], theater: "air", faceUp: false };
const idx = encodeAction(testAction);
const decoded = decodeAction(idx);
console.log(`Original: ${JSON.stringify(testAction)}`);
console.log(`Index: ${idx}`);
console.log(`Decoded:  ${JSON.stringify(decoded)}`);
console.log(`Match: ${JSON.stringify(testAction) === JSON.stringify(decoded)}`);
console.log();

// Player-1 should have no legal actions (not their turn)
const mask1 = legalActionMask(view1);
console.log(`Player-1 legal actions (should be 0): ${countLegal(mask1)}`);
console.log();

// Play a move and re-encode
console.log("=== After First Move ===");
const firstAction = legalActions.find(a => a.type === "play" && a.faceUp)!;
console.log(`Playing: ${JSON.stringify(firstAction)}`);
runner.applyAction("player-0", firstAction);

const view0After = runner.getView("player-0") as ALSView;
const view1After = runner.getView("player-1") as ALSView;
const encoded0After = encodeState(view0After);

console.log("Current player after move:", view0After.currentPlayer);
console.log("Player-0 hand size:", view0After.myHand.length);
console.log("Opponent hand size (from p0 view):", view0After.opponentHandSize);
console.log();
console.log(describeEncoding(encoded0After));
console.log();

// Player-1 should now have legal actions
const mask1After = legalActionMask(view1After);
console.log(`Player-1 legal actions after p0 move: ${countLegal(mask1After)}`);
const p1Actions = listLegalActions(mask1After);
for (const a of p1Actions.slice(0, 5)) {
  console.log(` - ${JSON.stringify(a)}`);
}
if (p1Actions.length > 5) console.log(` ... and ${p1Actions.length - 5} more`);

// Verify all legal actions pass validation
console.log("\n=== Validation Check ===");
let allValid = true;
for (const a of p1Actions) {
  const err = alsGame.validateAction(runner.getState() as ALSState, a, "player-1");
  if (err) {
    console.log(`INVALID: ${JSON.stringify(a)} → ${err}`);
    allValid = false;
  }
}

// Also check that no illegal actions pass validation
let falsePositives = 0;
for (let i = 0; i < ACTION_SIZE; i++) {
  if (mask1After[i] < 0.5) {
    const a = decodeAction(i);
    const err = alsGame.validateAction(runner.getState() as ALSState, a, "player-1");
    if (err === null) {
      console.log(`FALSE NEGATIVE (should be legal): ${JSON.stringify(a)}`);
      falsePositives++;
    }
  }
}

console.log(`All legal actions valid: ${allValid}`);
console.log(`Illegal actions that are actually legal: ${falsePositives}`);
console.log();
console.log("=== Done ===");
