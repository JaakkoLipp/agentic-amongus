/**
 * Small deterministic PRNG (sfc32) with labelled sub-streams.
 *
 * Every subsystem derives its own stream from the match seed (`deriveRng(seed, "tasks", playerId)`),
 * so adding a random call in one subsystem never perturbs another. State is four uint32 values and can be
 * snapshotted for replays.
 */
export type RngState = readonly [number, number, number, number];

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(state: RngState) {
    [this.a, this.b, this.c, this.d] = state;
  }

  static fromSeed(seed: number): Rng {
    const sm = splitmix32(seed >>> 0);
    const rng = new Rng([sm(), sm(), sm(), sm()]);
    for (let i = 0; i < 12; i++) rng.nextUint32();
    return rng;
  }

  snapshot(): RngState {
    return [this.a, this.b, this.c, this.d];
  }

  nextUint32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    if (max < min) throw new Error(`Rng.int: empty range [${min}, ${max}]`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick: empty array");
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** Pick with probability proportional to weight. Non-positive weights are never chosen unless all are. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    if (items.length === 0) throw new Error("Rng.weighted: empty array");
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    if (total <= 0) return this.pick(items);
    let r = this.next() * total;
    for (const it of items) {
      r -= Math.max(0, weight(it));
      if (r < 0) return it;
    }
    return items[items.length - 1] as T;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  }

  sample<T>(items: readonly T[], count: number): T[] {
    return this.shuffle(items).slice(0, Math.max(0, count));
  }
}

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/** FNV-1a 32-bit hash over a label path; used to derive independent seeds. */
export function hashSeed(seed: number, ...path: readonly (string | number)[]): number {
  let h = 0x811c9dc5 ^ (seed >>> 0);
  h = Math.imul(h, 0x01000193) >>> 0;
  for (const part of path) {
    const s = typeof part === "number" ? `#${part}` : part;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export const deriveRng = (seed: number, ...path: readonly (string | number)[]): Rng => Rng.fromSeed(hashSeed(seed, ...path));
