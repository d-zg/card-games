import type { CardDef, Theater } from "./types.js";

export const ALL_CARDS: readonly CardDef[] = [
  // AIR
  { id: "air-1", theater: "air", strength: 1, name: "Support", abilityType: "ongoing", abilityText: "+3 strength in each adjacent theater." },
  { id: "air-2", theater: "air", strength: 2, name: "Air Drop", abilityType: "instant", abilityText: "Next turn, play a card face-up to any theater." },
  { id: "air-3", theater: "air", strength: 3, name: "Maneuver", abilityType: "instant", abilityText: "Flip a card in an adjacent theater." },
  { id: "air-4", theater: "air", strength: 4, name: "Aerodrome", abilityType: "ongoing", abilityText: "Play strength 3 or less cards face-up to any theater." },
  { id: "air-5", theater: "air", strength: 5, name: "Containment", abilityType: "ongoing", abilityText: "Any card played face-down is discarded." },
  { id: "air-6", theater: "air", strength: 6, name: "Heavy Bomber", abilityType: "none", abilityText: "No ability. Pure strength." },

  // LAND
  { id: "land-1", theater: "land", strength: 1, name: "Reinforce", abilityType: "instant", abilityText: "Peek at top of deck. May play it face-down to an adjacent theater." },
  { id: "land-2", theater: "land", strength: 2, name: "Ambush", abilityType: "instant", abilityText: "Flip a card in any theater." },
  { id: "land-3", theater: "land", strength: 3, name: "Maneuver", abilityType: "instant", abilityText: "Flip a card in an adjacent theater." },
  { id: "land-4", theater: "land", strength: 4, name: "Cover Fire", abilityType: "ongoing", abilityText: "Cards covered by this card become strength 4." },
  { id: "land-5", theater: "land", strength: 5, name: "Disrupt", abilityType: "instant", abilityText: "Opponent flips one of theirs, then you flip one of yours." },
  { id: "land-6", theater: "land", strength: 6, name: "Heavy Tanks", abilityType: "none", abilityText: "No ability. Pure strength." },

  // SEA
  { id: "sea-1", theater: "sea", strength: 1, name: "Transport", abilityType: "instant", abilityText: "Move one of your cards to a different theater." },
  { id: "sea-2", theater: "sea", strength: 2, name: "Escalation", abilityType: "ongoing", abilityText: "Your face-down cards are strength 4 instead of 2." },
  { id: "sea-3", theater: "sea", strength: 3, name: "Maneuver", abilityType: "instant", abilityText: "Flip a card in an adjacent theater." },
  { id: "sea-4", theater: "sea", strength: 4, name: "Redeploy", abilityType: "instant", abilityText: "Pick up a face-down card. If you do, take an extra turn." },
  { id: "sea-5", theater: "sea", strength: 5, name: "Blockade", abilityType: "ongoing", abilityText: "Cards played to an adjacent theater with 3+ cards are discarded." },
  { id: "sea-6", theater: "sea", strength: 6, name: "Super Battleship", abilityType: "none", abilityText: "No ability. Pure strength." },
];

const cardMap = new Map<string, CardDef>(ALL_CARDS.map((c) => [c.id, c]));

export function getCard(cardId: string): CardDef {
  const card = cardMap.get(cardId);
  if (!card) throw new Error(`Unknown card: ${cardId}`);
  return card;
}

/** Theaters adjacent to a given theater. Air <-> Land <-> Sea. */
export function adjacentTheaters(theater: Theater): Theater[] {
  switch (theater) {
    case "air": return ["land"];
    case "land": return ["air", "sea"];
    case "sea": return ["land"];
  }
}
