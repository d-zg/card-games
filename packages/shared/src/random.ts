export interface SeededRng {
  /** Returns a float in [0, 1) */
  next(): number;
  /** Returns an integer in [min, max) */
  int(min: number, max: number): number;
  /** Returns a random element from the array */
  pick<T>(array: T[]): T;
  /** Shuffles array in place and returns it */
  shuffle<T>(array: T[]): T[];
}

/**
 * Mulberry32 — a simple, fast 32-bit seeded PRNG.
 * Deterministic: same seed always produces the same sequence.
 */
export function createRng(seed: number): SeededRng {
  let state = seed | 0;

  function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,
    int(min: number, max: number): number {
      return min + Math.floor(next() * (max - min));
    },
    pick<T>(array: T[]): T {
      if (array.length === 0) throw new Error("Cannot pick from empty array");
      return array[Math.floor(next() * array.length)];
    },
    shuffle<T>(array: T[]): T[] {
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
      return array;
    },
  };
}
