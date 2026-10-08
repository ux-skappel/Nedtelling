/**
 * Figure series generator (Gf, induction).
 *
 * Six panels are shown; the participant chooses the seventh. Each attribute
 * (arrow direction, marker position, fill, size, count) follows one rule:
 *
 *   constant · cyclic progression (fixed step) · alternation (period 2) ·
 *   repetition with period 3 · two interleaved progressions ·
 *   accelerating progression (the step itself grows by a constant)
 *
 * Options use the same attribute-bisection tree as the matrices, and the
 * independent solver in `solvers/seriesSolver.ts` must find exactly one
 * option consistent with every rule it can infer.
 */

import type { Rng } from "../../random";
import { describeFigure, DIRECTION_NAMES, POSITION_NAMES } from "../figures";
import { estimateTime, makeDifficulty } from "../difficulty";
import { FILLS, SHAPES, type FigureLayer, type FigureSpec, type Item, type ShapeKind } from "../types";
import { solveSeries } from "../solvers/seriesSolver";
import { choiceResponse, retry } from "./common";

export const SERIES_GENERATOR = { name: "figure-series", version: "1.0.0" };

type Attr = "orientation" | "marker" | "fill" | "size" | "count";
type Rule = "const" | "cyc1" | "cyc2" | "alt" | "rep3" | "interleave" | "accel";

export interface SeriesRecipe {
  rules: Partial<Record<Attr, Rule>>;
  /** Use an arrow (needed when orientation varies). */
  arrow?: boolean;
  /** Include the marker layer even if its rule is constant. */
  marker?: boolean;
}

const N_SHOWN = 6;
const N_TOTAL = N_SHOWN + 1;

const MOD: Record<Attr, number> = { orientation: 8, marker: 8, fill: 3, size: 3, count: 4 };
const CYCLIC: Record<Attr, boolean> = { orientation: true, marker: true, fill: false, size: false, count: false };

const WEIGHT: Record<Rule, number> = {
  const: 0,
  cyc1: 0.6,
  cyc2: 0.8,
  alt: 0.5,
  rep3: 0.7,
  interleave: 1.5,
  accel: 1.6,
};

interface Track {
  values: number[]; // length N_TOTAL
  rule: Rule;
  detail: string;
  sentence: string | null;
}

function mod(x: number, n: number) {
  return ((x % n) + n) % n;
}

function valueName(attr: Attr, v: number): string {
  switch (attr) {
    case "orientation":
      return DIRECTION_NAMES[v];
    case "marker":
      return POSITION_NAMES[v];
    case "fill":
      return ["white", "striped", "black"][v];
    case "size":
      return ["small", "medium", "large"][v];
    case "count":
      return String(v + 1);
  }
}

const NOUN: Record<Attr, string> = {
  orientation: "arrow",
  marker: "dot",
  fill: "fill",
  size: "size",
  count: "number of shapes",
};

function genTrack(attr: Attr, rule: Rule, rng: Rng): Track | null {
  const n = MOD[attr];
  const cyclic = CYCLIC[attr];
  const turnWord = (s: number) =>
    attr === "orientation"
      ? `turns ${Math.abs(s) * 45}° ${s > 0 ? "clockwise" : "anticlockwise"}`
      : `moves ${Math.abs(s)} position${Math.abs(s) > 1 ? "s" : ""} ${s > 0 ? "clockwise" : "anticlockwise"}`;
  switch (rule) {
    case "const": {
      const v = rng.int(0, n - 1);
      return { values: Array(N_TOTAL).fill(v), rule, detail: "const", sentence: null };
    }
    case "cyc1":
    case "cyc2": {
      if (!cyclic) return null;
      const mag = rule === "cyc1" ? 1 : rng.pick([2, 3]);
      const s = rng.bool() ? mag : -mag;
      const v0 = rng.int(0, n - 1);
      return {
        values: Array.from({ length: N_TOTAL }, (_, t) => mod(v0 + s * t, n)),
        rule,
        detail: `step ${s}`,
        sentence: `The ${NOUN[attr]} ${turnWord(s)} from each panel to the next.`,
      };
    }
    case "alt": {
      const [a, b] = rng.sample(Array.from({ length: n }, (_, i) => i), 2);
      return {
        values: Array.from({ length: N_TOTAL }, (_, t) => (t % 2 === 0 ? a : b)),
        rule,
        detail: `${a}/${b}`,
        sentence: `The ${NOUN[attr]} alternates between ${valueName(attr, a)} and ${valueName(attr, b)}.`,
      };
    }
    case "rep3": {
      const vals = rng.sample(Array.from({ length: n }, (_, i) => i), 3);
      return {
        values: Array.from({ length: N_TOTAL }, (_, t) => vals[t % 3]),
        rule,
        detail: vals.join("/"),
        sentence: `The ${NOUN[attr]} repeats in a cycle of three: ${vals.map((v) => valueName(attr, v)).join(", ")}.`,
      };
    }
    case "interleave": {
      if (!cyclic) return null;
      const s1 = rng.pick([1, 2, -1, -2]);
      let s2 = rng.pick([1, 2, 3, -1, -2, -3]);
      if (s2 === s1) s2 = -s1;
      const a0 = rng.int(0, n - 1);
      const b0 = rng.int(0, n - 1);
      return {
        values: Array.from({ length: N_TOTAL }, (_, t) =>
          t % 2 === 0 ? mod(a0 + s1 * (t / 2), n) : mod(b0 + s2 * ((t - 1) / 2), n),
        ),
        rule,
        detail: `odd ${s1}, even ${s2}`,
        sentence: `Two series are interleaved: in panels 1, 3, 5 and 7 the ${NOUN[attr]} ${turnWord(s1)} each time; in panels 2, 4 and 6 it ${turnWord(s2)} each time.`,
      };
    }
    case "accel": {
      if (!cyclic) return null;
      // Start at a step of 0 so every visible move is at most 4 × 45°
      // (beyond that a clockwise move looks like a shorter anticlockwise one).
      const s0 = 0;
      const inc = rng.bool() ? 1 : -1;
      const v0 = rng.int(0, n - 1);
      const values = [v0];
      let step = s0;
      for (let t = 1; t < N_TOTAL; t++) {
        values.push(mod(values[t - 1] + step, n));
        step += inc;
      }
      const steps = Array.from({ length: N_SHOWN }, (_, i) => s0 + i * inc);
      return {
        values,
        rule,
        detail: `steps ${steps.join(",")}`,
        sentence: `The ${NOUN[attr]} moves by a growing amount: ${steps
          .map((s) => Math.abs(s))
          .join(", ")} step${steps.length > 1 ? "s" : ""} ${inc > 0 ? "clockwise" : "anticlockwise"}${attr === "orientation" ? " (in 45° steps)" : ""}.`,
      };
    }
  }
}

function panel(vals: Record<Attr, number>, shape: ShapeKind, withMarker: boolean): FigureSpec {
  const layers: FigureLayer[] = [
    {
      kind: "entity",
      shape,
      count: vals.count + 1,
      size: vals.size,
      fill: FILLS[vals.fill],
      orientation: shape === "arrow" ? vals.orientation : 0,
      ...(vals.count === 0 ? { large: true } : {}),
    },
  ];
  if (withMarker) layers.push({ kind: "marker", position: vals.marker, shape: "dot" });
  return { layers };
}

function altCandidates(attr: Attr, track: Track): number[] {
  const n = MOD[attr];
  const v = track.values;
  const key = v[N_SHOWN];
  const c = [v[N_SHOWN - 1], v[N_SHOWN - 2], ...v.slice(0, N_SHOWN)];
  if (CYCLIC[attr]) c.push(mod(key + 1, n), mod(key - 1, n), mod(v[N_SHOWN - 1] + (v[N_SHOWN - 1] - v[N_SHOWN - 2]), n));
  const out = [...new Set(c)].filter((x) => x !== key && x >= 0 && x < n);
  return out.length ? out : Array.from({ length: n }, (_, i) => i).filter((x) => x !== key);
}

export function generateSeriesItem(recipe: SeriesRecipe, id: string, seed: number, rngFactory: (s: number) => Rng): Item {
  const rng = rngFactory(seed);
  const built = retry(`series ${id}`, 500, () => {
    const arrow = recipe.arrow ?? recipe.rules.orientation !== undefined;
    const withMarker = recipe.marker ?? recipe.rules.marker !== undefined;
    const shape: ShapeKind = arrow ? "arrow" : rng.pick(SHAPES.filter((s) => s !== "cross"));
    const attrs: Attr[] = ["orientation", "marker", "fill", "size", "count"];
    const tracks = {} as Record<Attr, Track>;
    for (const a of attrs) {
      const rule = recipe.rules[a] ?? "const";
      let t: Track | null;
      if (rule === "const" && a === "count") t = { values: Array(N_TOTAL).fill(0), rule, detail: "const", sentence: null };
      else if (rule === "const" && a === "orientation" && !arrow) t = { values: Array(N_TOTAL).fill(0), rule, detail: "const", sentence: null };
      else t = genTrack(a, rule, rng);
      if (!t) throw new Error(`Rule ${rule} not available for ${a}`);
      tracks[a] = t;
    }
    // Several shapes and a marker in one small panel get crowded: keep count
    // variation and the marker apart.
    const panels = Array.from({ length: N_TOTAL }, (_, t) =>
      panel(Object.fromEntries(attrs.map((a) => [a, tracks[a].values[t]])) as Record<Attr, number>, shape, withMarker),
    );

    const perturbable = attrs.filter(
      (a) => !(a === "orientation" && !arrow) && !(a === "marker" && !withMarker) && !(a === "count" && withMarker),
    );
    const varying = perturbable.filter((a) => tracks[a].rule !== "const");
    const constant = perturbable.filter((a) => tracks[a].rule === "const");
    const chosen = [...rng.shuffle(varying), ...rng.shuffle(constant)].slice(0, 3);
    if (chosen.length < 3) return null;
    const keyVals = Object.fromEntries(attrs.map((a) => [a, tracks[a].values[N_SHOWN]])) as Record<Attr, number>;
    const alts = chosen.map((a) => rng.pick(altCandidates(a, tracks[a])));
    const options: FigureSpec[] = [];
    for (let mask = 0; mask < 8; mask++) {
      const vals = { ...keyVals };
      chosen.forEach((a, i) => {
        if (mask & (1 << i)) vals[a] = alts[i];
      });
      options.push(panel(vals, shape, withMarker));
    }
    if (new Set(options.map((o) => JSON.stringify(o))).size !== 8) return null;
    const solved = solveSeries(panels.slice(0, N_SHOWN), options);
    if (solved.status !== "unique" || solved.optionIndex !== 0) return null;

    const rules = attrs.filter((a) => tracks[a].rule !== "const").map((a) => `${a}:${tracks[a].rule}(${tracks[a].detail})`);
    const nVarying = rules.length;
    const logit =
      -2.2 + attrs.reduce((s, a) => s + WEIGHT[tracks[a].rule], 0) + 0.4 * Math.max(0, nVarying - 1);
    const sentences = attrs.map((a) => tracks[a].sentence).filter((s): s is string => !!s);
    return { panels, options, rules, logit, sentences, nVarying };
  });

  const response = choiceResponse(
    rng,
    { type: "figure", figure: built.options[0] },
    built.options.slice(1).map((figure) => ({ type: "figure" as const, figure })),
  );
  const difficulty = makeDifficulty("series-complexity@1", built.logit, {
    nRules: built.nVarying,
    rules: built.rules.join(" "),
  });
  return {
    id,
    version: 1,
    domain: "Gf",
    narrowAbility: "I",
    family: "figure-series",
    practice: false,
    prompt: "Which figure comes next in the series?",
    stimulus: { type: "figure-series", panels: built.panels.slice(0, N_SHOWN) },
    response,
    explanation: `${built.sentences.join(" ")} The next panel therefore shows ${describeFigure(built.options[0])}.`,
    rules: built.rules,
    difficulty,
    estimatedTimeSec: estimateTime(35, difficulty.level),
    timeLimitSec: 120,
    provenance: { generator: SERIES_GENERATOR.name, generatorVersion: SERIES_GENERATOR.version, seed },
  };
}

export const SERIES_PLAN: SeriesRecipe[] = [
  // ~ level 1
  { rules: { orientation: "cyc1" } },
  { rules: { marker: "cyc1" } },
  { rules: { fill: "rep3" } },
  { rules: { size: "alt" } },
  // ~ level 2
  { rules: { marker: "cyc2" } },
  { rules: { orientation: "cyc2" } },
  { rules: { count: "rep3" } },
  { rules: { orientation: "cyc1", fill: "alt" } },
  // ~ level 3
  { rules: { orientation: "cyc1", marker: "cyc2" } },
  { rules: { marker: "cyc1", size: "rep3" } },
  { rules: { orientation: "cyc2", fill: "rep3" } },
  { rules: { marker: "interleave" } },
  // ~ level 4
  { rules: { orientation: "interleave", fill: "alt" } },
  { rules: { marker: "accel" } },
  { rules: { orientation: "cyc1", marker: "cyc2", fill: "rep3" } },
  { rules: { orientation: "accel", size: "alt" } },
  // ~ level 5
  { rules: { orientation: "interleave", marker: "cyc2" } },
  { rules: { marker: "accel", orientation: "cyc2", fill: "rep3" } },
  { rules: { orientation: "accel", marker: "interleave" } },
  { rules: { marker: "interleave", orientation: "cyc1", size: "rep3" } },
  { rules: { orientation: "interleave", marker: "accel" } },
  { rules: { marker: "interleave", fill: "rep3", size: "alt" } },
  { rules: { orientation: "accel", marker: "cyc2", fill: "alt" } },
  { rules: { orientation: "interleave", marker: "interleave", fill: "rep3" } },
];
