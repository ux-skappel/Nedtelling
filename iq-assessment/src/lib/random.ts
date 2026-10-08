/**
 * Seeded, serialisable pseudo-random number generator (mulberry32).
 *
 * Every random decision in item generation and test administration goes
 * through this generator so that (a) the item bank is reproducible from its
 * seeds and (b) a session can be recovered mid-test and continue with exactly
 * the same item selection and option order it would have had without the
 * interruption. The whole state is a single 32-bit integer.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  get state(): number {
    return this.s;
  }

  static fromState(state: number): Rng {
    return new Rng(state);
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  bool(pTrue = 0.5): boolean {
    return this.next() < pTrue;
  }

  pick<T>(xs: readonly T[]): T {
    if (xs.length === 0) throw new Error("Rng.pick on empty array");
    return xs[Math.floor(this.next() * xs.length)];
  }

  /** Returns a new shuffled array (Fisher–Yates). */
  shuffle<T>(xs: readonly T[]): T[] {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /** k distinct elements, order randomised. */
  sample<T>(xs: readonly T[], k: number): T[] {
    if (k > xs.length) throw new Error("Rng.sample: k larger than population");
    return this.shuffle(xs).slice(0, k);
  }

  /** Standard normal deviate (Box–Muller). */
  normal(mean = 0, sd = 1): number {
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

/** A 32-bit seed derived from a string (FNV-1a). */
export function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A fresh seed for a new session, from the platform CSPRNG when available. */
export function freshSeed(): number {
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return buf[0];
  }
  return Math.floor(Math.random() * 2 ** 32) >>> 0;
}
