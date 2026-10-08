/**
 * Processing-speed trials (Gs, perceptual speed "P").
 *
 *  - Symbol search: does either of two target symbols appear in a row of
 *    five? The symbols are original abstract glyphs (3–4 strokes on a 3×3
 *    dot grid), and the row's foils are chosen to resemble the targets, so the
 *    decision needs a careful comparison rather than a glance.
 *  - Visual comparison: are two strings of letters and digits identical?
 *    Different pairs differ in exactly one character, replaced by a visually
 *    similar one, or by swapping two neighbours.
 *
 * Trials are easy by design; the score is how many are answered correctly per
 * minute, net of errors. These items are not IRT-scored.
 */

import type { Rng } from "../../random";
import { makeDifficulty } from "../difficulty";
import type { Item } from "../types";
import { pad, retry } from "./common";

export const SPEED_GENERATOR = { name: "speed", version: "1.0.0" };

/** The 20 strokes between neighbouring points of a 3×3 grid (points 0..8, row-major). */
export const GLYPH_SEGMENTS: [number, number][] = (() => {
  const segs: [number, number][] = [];
  const idx = (c: number, r: number) => r * 3 + c;
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      if (c < 2) segs.push([idx(c, r), idx(c + 1, r)]);
      if (r < 2) segs.push([idx(c, r), idx(c, r + 1)]);
      if (c < 2 && r < 2) {
        segs.push([idx(c, r), idx(c + 1, r + 1)]);
        segs.push([idx(c + 1, r), idx(c, r + 1)]);
      }
    }
  return segs;
})();

function connected(segs: number[]): boolean {
  const pts = new Set(segs.flatMap((s) => GLYPH_SEGMENTS[s]));
  const start = GLYPH_SEGMENTS[segs[0]][0];
  const seen = new Set([start]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of segs) {
      const [a, b] = GLYPH_SEGMENTS[s];
      if (seen.has(a) && !seen.has(b)) {
        seen.add(b);
        grew = true;
      }
      if (seen.has(b) && !seen.has(a)) {
        seen.add(a);
        grew = true;
      }
    }
  }
  return seen.size === pts.size;
}

const distance = (a: number[], b: number[]) => a.filter((x) => !b.includes(x)).length + b.filter((x) => !a.includes(x)).length;

/** A fixed set of 24 glyphs, pairwise differing in at least 3 strokes. */
export function generateGlyphs(seed: number, rngFactory: (s: number) => Rng): number[][] {
  const rng = rngFactory(seed);
  const glyphs: number[][] = [];
  const all = GLYPH_SEGMENTS.map((_, i) => i);
  for (let guard = 0; glyphs.length < 24 && guard < 20000; guard++) {
    const g = rng.sample(all, rng.int(3, 4)).sort((a, b) => a - b);
    if (!connected(g)) continue;
    if (glyphs.some((h) => distance(g, h) < 3)) continue;
    glyphs.push(g);
  }
  if (glyphs.length < 24) throw new Error("Could not generate glyph set");
  return glyphs;
}

export const GLYPH_SEED = 424242;

function speedDifficulty(task: string) {
  return makeDifficulty("speed-trial@1", -2.5, { task, note: "speed trial: scored as rate, not by IRT" });
}

export function generateSymbolSearchTrials(n: number, seed: number, rngFactory: (s: number) => Rng, practice = false): Item[] {
  const rng = rngFactory(seed);
  const glyphs = generateGlyphs(GLYPH_SEED, rngFactory);
  const ids = glyphs.map((_, i) => i);
  const out: Item[] = [];
  // Exactly half of the trials contain a target, in random order.
  const presence = rng.shuffle(Array.from({ length: n }, (_, i) => i < Math.ceil(n / 2)));
  for (let i = 0; i < n; i++) {
    const present = presence[i];
    const targets = rng.sample(ids, 2);
    // Foils that resemble the targets (stroke distance 3–4) where possible.
    const similar = ids.filter((g) => !targets.includes(g) && targets.some((t) => distance(glyphs[g], glyphs[t]) <= 4));
    const others = ids.filter((g) => !targets.includes(g) && !similar.includes(g));
    const pool = [...rng.shuffle(similar), ...rng.shuffle(others)];
    const group = pool.slice(0, present ? 4 : 5);
    if (present) group.splice(rng.int(0, 4), 0, rng.pick(targets));
    out.push({
      id: practice ? `PR-GS-SS-${pad(i + 1)}` : `GS-SS-${pad(i + 1)}`,
      version: 1,
      domain: "Gs",
      narrowAbility: "P",
      family: "symbol-search",
      practice,
      prompt: "Does either symbol on the left appear in the row?",
      stimulus: { type: "symbol-search", targets, group },
      response: { kind: "binary", labels: ["Yes", "No"], correct: present ? 0 : 1 },
      explanation: present ? "One of the target symbols appears in the row." : "Neither target symbol appears in the row.",
      rules: [`present:${present}`],
      difficulty: speedDifficulty("symbol-search"),
      estimatedTimeSec: 2,
      timeLimitSec: null,
      provenance: { generator: SPEED_GENERATOR.name, generatorVersion: SPEED_GENERATOR.version, seed },
    });
  }
  return out;
}

const CHARS = "ACEFHKLMNPRTUVWXY2345679".split("");
const CONFUSABLE: Record<string, string[]> = {
  E: ["F"],
  F: ["E", "P"],
  M: ["N", "W"],
  N: ["M", "H"],
  H: ["N"],
  P: ["R", "F"],
  R: ["P"],
  U: ["V"],
  V: ["U", "Y"],
  Y: ["V"],
  K: ["X"],
  X: ["K", "Y"],
  W: ["M"],
  C: ["E"],
  L: ["T"],
  T: ["L", "Y"],
  "3": ["9", "5"],
  "5": ["6", "3"],
  "6": ["5", "9"],
  "9": ["6", "3"],
  "2": ["7"],
  "7": ["2", "4"],
  "4": ["7"],
  A: ["H"],
};

export function generateComparisonTrials(n: number, seed: number, rngFactory: (s: number) => Rng, practice = false): Item[] {
  const rng = rngFactory(seed);
  const out: Item[] = [];
  const sameness = rng.shuffle(Array.from({ length: n }, (_, i) => i < Math.ceil(n / 2)));
  for (let i = 0; i < n; i++) {
    const len = rng.int(5, 8);
    const left = retry("comparison", 100, () => {
      const s = Array.from({ length: len }, () => rng.pick(CHARS));
      // no immediate repeats, so a swap always produces a visible change
      return s.some((c, j) => j > 0 && c === s[j - 1]) ? null : s;
    });
    const same = sameness[i];
    const right = [...left];
    let change = "none";
    if (!same) {
      if (rng.bool(0.7)) {
        const j = rng.int(0, len - 1);
        right[j] = rng.pick(CONFUSABLE[left[j]] ?? CHARS.filter((c) => c !== left[j]));
        change = `substitute@${j}`;
      } else {
        const j = rng.int(0, len - 2);
        [right[j], right[j + 1]] = [right[j + 1], right[j]];
        change = `swap@${j}`;
      }
    }
    out.push({
      id: practice ? `PR-GS-VC-${pad(i + 1)}` : `GS-VC-${pad(i + 1)}`,
      version: 1,
      domain: "Gs",
      narrowAbility: "P",
      family: "visual-comparison",
      practice,
      prompt: "Are the two strings exactly the same?",
      stimulus: { type: "visual-comparison", left: left.join(""), right: right.join("") },
      response: { kind: "binary", labels: ["Same", "Different"], correct: same ? 0 : 1 },
      explanation: same ? "The strings are identical." : "The strings differ in one place.",
      rules: [`change:${change}`],
      difficulty: speedDifficulty("visual-comparison"),
      estimatedTimeSec: 2,
      timeLimitSec: null,
      provenance: { generator: SPEED_GENERATOR.name, generatorVersion: SPEED_GENERATOR.version, seed },
    });
  }
  return out;
}
