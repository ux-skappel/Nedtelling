/**
 * Matrix reasoning generator (Gf, induction).
 *
 * Items are 3×3 matrices with the bottom-right cell missing. Each cell is a
 * structured figure; every visual attribute is governed by an explicit rule
 * from the taxonomy of Carpenter, Just & Shell (1990):
 *
 *   constant in a row · quantitative pairwise progression ·
 *   distribution of three values · figure addition/subtraction ·
 *   superimposition (OR / AND / XOR / subtraction of line elements)
 *
 * Answer options are built with the attribute-bisection tree used in I-RAVEN
 * (Hu et al., 2021): three attributes are each set to either the correct value
 * or one plausible wrong value, and the 2³ = 8 combinations form the options.
 * Every attribute value therefore occurs in exactly half of the options, so the
 * answer cannot be found by picking the most "typical" option without
 * looking at the matrix (the context-blind shortcut documented for the
 * original RAVEN dataset).
 *
 * The generator's own key is not trusted: every item is re-solved by the
 * independent solver in `solvers/matrixSolver.ts` and rejected unless exactly
 * one option satisfies the rules the solver infers.
 */

import type { Rng } from "../../random";
import { describeFigure, DIRECTION_NAMES, sameSet, setOps, sortedSet } from "../figures";
import { estimateTime, makeDifficulty } from "../difficulty";
import { FILLS, SHAPES, type EntityLayer, type FigureLayer, type FigureSpec, type Item } from "../types";
import { solveMatrix } from "../solvers/matrixSolver";
import { choiceResponse, retry } from "./common";

export const MATRIX_GENERATOR = { name: "matrix", version: "1.0.0" };

type Attr = "shape" | "count" | "size" | "fill" | "orientation";
type RuleSpec = "const-global" | "const-row" | "prog" | "prog2" | "dist3" | "add" | "sub";
type LinesRule = "or" | "and" | "xor" | "minus";
type MarkerRule = "prog" | "dist3";

export interface MatrixRecipe {
  template: "entity" | "lines";
  variant?: "shapes" | "arrow";
  entityRules?: Partial<Record<Attr, RuleSpec>>;
  linesRule?: LinesRule;
  markerRule?: MarkerRule;
}

type Grid = number[][]; // [row][col]

const ATTRS: Attr[] = ["shape", "count", "size", "fill", "orientation"];

const DOMAIN: Record<Attr, number[]> = {
  shape: [0, 1, 2, 3, 4, 5, 6, 7],
  count: [1, 2, 3, 4],
  size: [0, 1, 2],
  fill: [0, 1, 2],
  orientation: [0, 1, 2, 3, 4, 5, 6, 7],
};

const ADD_TRIPLES = [
  [1, 1, 2],
  [1, 2, 3],
  [2, 1, 3],
  [2, 2, 4],
  [1, 3, 4],
  [3, 1, 4],
];
const SUB_TRIPLES = [
  [2, 1, 1],
  [3, 1, 2],
  [3, 2, 1],
  [4, 1, 3],
  [4, 2, 2],
  [4, 3, 1],
];

/** Complexity-model weights (expert judgement, see difficulty.ts). */
const RULE_WEIGHT: Record<string, number> = {
  "const-global": 0,
  "const-row": 0.25,
  prog: 0.6,
  prog2: 0.8,
  dist3: 0.95,
  add: 1.2,
  sub: 1.35,
  or: 1.0,
  minus: 1.6,
  and: 1.7,
  xor: 2.2,
  "marker-prog": 0.6,
  "marker-dist3": 0.95,
};
const INTERCEPT = -2.2;
const PER_EXTRA_RULE = 0.35;

function latinSquare(values: number[], rng: Rng): Grid {
  const base = [0, 1, 2].map((r) => [0, 1, 2].map((c) => values[(r + c) % 3]));
  const rows = rng.shuffle([0, 1, 2]);
  const cols = rng.shuffle([0, 1, 2]);
  return rows.map((r) => cols.map((c) => base[r][c]));
}

function genAttribute(attr: Attr, spec: RuleSpec, rng: Rng): { grid: Grid; step?: number } {
  const dom = DOMAIN[attr];
  switch (spec) {
    case "const-global": {
      const v = rng.pick(dom);
      return { grid: [0, 1, 2].map(() => [v, v, v]) };
    }
    case "const-row": {
      const vals = rng.sample(dom, 3);
      return { grid: vals.map((v) => [v, v, v]) };
    }
    case "prog":
    case "prog2": {
      if (attr === "orientation") {
        const mag = spec === "prog2" ? 2 : 1;
        const step = rng.bool() ? mag : -mag;
        const starts = rng.sample(dom, 3);
        return { grid: starts.map((s) => [0, 1, 2].map((c) => (((s + c * step) % 8) + 8) % 8)), step };
      }
      if (attr === "count") {
        const step = rng.bool() ? 1 : -1;
        const starts = step === 1 ? [1, 2] : [3, 4];
        const rows = [rng.pick(starts), rng.pick(starts), rng.pick(starts)];
        return { grid: rows.map((s) => [s, s + step, s + 2 * step]), step };
      }
      if (attr === "size") {
        const step = rng.bool() ? 1 : -1;
        const s = step === 1 ? 0 : 2;
        return { grid: [0, 1, 2].map(() => [s, s + step, s + 2 * step]), step };
      }
      throw new Error(`Progression not defined for ${attr}`);
    }
    case "dist3":
      return { grid: latinSquare(rng.sample(dom, 3), rng) };
    case "add":
    case "sub": {
      if (attr !== "count") throw new Error("Arithmetic rules apply to count only");
      const triples = rng.sample(spec === "add" ? ADD_TRIPLES : SUB_TRIPLES, 3);
      return { grid: triples.map((t) => [...t]) };
    }
  }
}

/** Per row, the element sets [A, B, A∘B]. */
function genLines(rule: LinesRule, rng: Rng): number[][][] | null {
  const rows: number[][][] = [];
  const elements = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let r = 0; r < 3; r++) {
    let ok = false;
    for (let attempt = 0; attempt < 200 && !ok; attempt++) {
      const a = sortedSet(rng.sample(elements, rng.int(2, 4)));
      const b = sortedSet(rng.sample(elements, rng.int(2, 4)));
      const c = setOps[rule](a, b);
      const inter = setOps.and(a, b);
      if (c.length === 0 || sameSet(c, a) || sameSet(c, b)) continue;
      if ((rule === "xor" || rule === "and" || rule === "minus") && inter.length === 0) continue;
      if (rule === "or" && inter.length > 1) continue;
      if (rows.some((row) => sameSet(row[0], a) || sameSet(row[1], b))) continue;
      rows.push([a, b, c]);
      ok = true;
    }
    if (!ok) return null;
  }
  return rows;
}

function entityFigure(values: Record<Attr, number>, variant: "shapes" | "arrow", large: boolean): EntityLayer {
  return {
    kind: "entity",
    shape: variant === "arrow" ? "arrow" : SHAPES[values.shape],
    count: values.count,
    size: values.size,
    fill: FILLS[values.fill],
    orientation: variant === "arrow" ? values.orientation : 0,
    ...(large ? { large: true } : {}),
  };
}

interface Built {
  cells: FigureSpec[]; // 9 cells incl. key at index 8
  options: FigureSpec[]; // key first
  rules: string[];
  sentences: string[];
  features: Record<string, number | string | boolean>;
  logit: number;
}

function altCandidates(attr: Attr, spec: RuleSpec, grid: Grid, step: number | undefined): number[] {
  const key = grid[2][2];
  const cands: number[] = [grid[2][0], grid[2][1]];
  if (spec === "const-row" || spec === "const-global") cands.push(grid[0][2], grid[1][2]);
  if (spec === "prog" || spec === "prog2") {
    if (attr === "orientation") cands.push((key + (step ?? 1) + 8) % 8, (key - 2 * (step ?? 1) + 16) % 8);
    else cands.push(key + (step ?? 1));
  }
  if (spec === "add" || spec === "sub") cands.push(key + 1, key - 1);
  if (attr === "orientation") cands.push((key + 1) % 8, (key + 7) % 8, (key + 4) % 8);
  const dom = DOMAIN[attr];
  let filtered = [...new Set(cands)].filter((v) => v !== key && dom.includes(v));
  if (filtered.length === 0) filtered = dom.filter((v) => v !== key);
  return filtered;
}

function sentenceFor(attr: Attr, spec: RuleSpec, grid: Grid, step?: number): string | null {
  const nameOf = (v: number) =>
    attr === "shape"
      ? SHAPES[v]
      : attr === "fill"
        ? ["white", "striped", "black"][v]
        : attr === "size"
          ? ["small", "medium", "large"][v]
          : attr === "orientation"
            ? DIRECTION_NAMES[v]
            : String(v);
  const set = sortedSet(grid[0]).map(nameOf);
  const noun: Record<Attr, string> = {
    shape: "shape",
    count: "number of shapes",
    size: "size",
    fill: "fill",
    orientation: "direction",
  };
  switch (spec) {
    case "const-global":
      return null;
    case "const-row":
      return `Within each row every figure has the same ${noun[attr]}, but it changes from row to row.`;
    case "prog":
    case "prog2":
      if (attr === "count") return `Across each row the number of shapes ${step! > 0 ? "increases" : "decreases"} by one.`;
      if (attr === "size") return `Across each row the shapes get ${step! > 0 ? "larger" : "smaller"}.`;
      return `Across each row the arrow turns ${Math.abs(step!) * 45}° ${step! > 0 ? "clockwise" : "anticlockwise"}.`;
    case "dist3":
      return `Each row and each column contains the same three ${attr === "count" ? "quantities" : noun[attr] + "s"} (${set.join(", ")}), each exactly once.`;
    case "add":
      return "In each row the number of shapes in the third cell is the sum of the numbers in the first two cells.";
    case "sub":
      return "In each row the number of shapes in the third cell is the first cell's number minus the second cell's number.";
  }
}

const LINES_SENTENCE: Record<LinesRule, string> = {
  or: "In each row the third cell contains every line that appears in either of the first two cells.",
  and: "In each row the third cell keeps only the lines that appear in both of the first two cells.",
  xor: "In each row the third cell contains the lines that appear in exactly one of the first two cells; lines that appear in both cancel out.",
  minus: "In each row the third cell is the first cell with every line that also appears in the second cell removed.",
};

function buildEntity(recipe: MatrixRecipe, rng: Rng): Built | null {
  const variant = recipe.variant ?? "shapes";
  const rules = recipe.entityRules ?? {};
  const specs: Record<Attr, RuleSpec> = {
    shape: rules.shape ?? "const-global",
    count: rules.count ?? "const-global",
    size: rules.size ?? "const-global",
    fill: rules.fill ?? "const-global",
    orientation: rules.orientation ?? "const-global",
  };
  const grids = {} as Record<Attr, Grid>;
  const steps = {} as Record<Attr, number | undefined>;
  for (const attr of ATTRS) {
    if (variant === "shapes" && attr === "orientation") {
      grids[attr] = [0, 1, 2].map(() => [0, 0, 0]);
      continue;
    }
    if (variant === "arrow" && attr === "shape") {
      grids[attr] = [0, 1, 2].map(() => [0, 0, 0]);
      continue;
    }
    if (attr === "count" && specs.count === "const-global" && variant === "arrow") {
      grids[attr] = [0, 1, 2].map(() => [1, 1, 1]);
      continue;
    }
    const g = genAttribute(attr, specs[attr], rng);
    grids[attr] = g.grid;
    steps[attr] = g.step;
  }
  const large = grids.count.every((row) => row.every((v) => v === 1));

  const cellValues = (r: number, c: number) =>
    Object.fromEntries(ATTRS.map((a) => [a, grids[a][r][c]])) as Record<Attr, number>;
  const cells: FigureSpec[] = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) cells.push({ layers: [entityFigure(cellValues(r, c), variant, large)] });

  // Distractor tree: prefer rule-governed attributes, then constant ones.
  const perturbable = ATTRS.filter((a) => !(variant === "shapes" && a === "orientation") && !(variant === "arrow" && a === "shape"));
  const varying = perturbable.filter((a) => specs[a] !== "const-global");
  const constant = perturbable.filter((a) => specs[a] === "const-global");
  const chosen = [...rng.shuffle(varying), ...rng.shuffle(constant)].slice(0, 3);
  if (chosen.length < 3) return null;
  const keyVals = cellValues(2, 2);
  const alts = chosen.map((a) => rng.pick(altCandidates(a, specs[a], grids[a], steps[a])));
  const options: FigureSpec[] = [];
  for (let mask = 0; mask < 8; mask++) {
    const vals = { ...keyVals };
    chosen.forEach((a, i) => {
      if (mask & (1 << i)) vals[a] = alts[i];
    });
    options.push({ layers: [entityFigure(vals, variant, large)] });
  }

  const ruleStrings = ATTRS.filter((a) => specs[a] !== "const-global").map(
    (a) => `${a}:${specs[a]}${steps[a] !== undefined ? `(${steps[a]! > 0 ? "+" : ""}${steps[a]})` : ""}`,
  );
  const nVarying = ruleStrings.length;
  const logit =
    INTERCEPT +
    ATTRS.reduce((s, a) => s + RULE_WEIGHT[specs[a]], 0) +
    PER_EXTRA_RULE * Math.max(0, nVarying - 1);
  const sentences = ATTRS.map((a) => sentenceFor(a, specs[a], grids[a], steps[a])).filter((s): s is string => !!s);
  return {
    cells,
    options,
    rules: ruleStrings,
    sentences,
    features: { template: `entity-${variant}`, nRules: nVarying, rules: ruleStrings.join(" ") },
    logit,
  };
}

function buildLines(recipe: MatrixRecipe, rng: Rng): Built | null {
  const rule = recipe.linesRule!;
  const rows = genLines(rule, rng);
  if (!rows) return null;
  let marker: Grid | null = null;
  let markerStep: number | undefined;
  if (recipe.markerRule === "prog") {
    const step = rng.pick([1, 2, -1, -2]);
    const starts = rng.sample([0, 1, 2, 3, 4, 5, 6, 7], 3);
    marker = starts.map((s) => [0, 1, 2].map((c) => (((s + c * step) % 8) + 8) % 8));
    markerStep = step;
  } else if (recipe.markerRule === "dist3") {
    marker = latinSquare(rng.sample([0, 1, 2, 3, 4, 5, 6, 7], 3), rng);
  }
  const cellOf = (elements: number[], m: number | null): FigureSpec => {
    const layers: FigureLayer[] = [{ kind: "lines", elements }];
    if (m !== null) layers.push({ kind: "marker", position: m, shape: "dot" });
    return { layers };
  };
  const cells: FigureSpec[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cells.push(cellOf(rows[r][c], marker ? marker[r][c] : null));

  const [a3, b3, key] = rows[2];
  // Elements on which plausible alternative operations disagree with the key.
  const alternatives = [setOps.or(a3, b3), setOps.and(a3, b3), setOps.xor(a3, b3), setOps.minus(a3, b3), setOps.minus(b3, a3)];
  const diagnostic = sortedSet(
    alternatives.flatMap((alt) => setOps.xor(alt, key)),
  );
  const pool = rng.shuffle(diagnostic);
  const fallback = rng.shuffle(sortedSet([...a3, ...b3]).filter((e) => !pool.includes(e)));
  const rest = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((e) => !pool.includes(e) && !fallback.includes(e)));
  const nFlips = marker ? 2 : 3;
  const flips = [...pool, ...fallback, ...rest].slice(0, nFlips);

  let markerAlt: number | null = null;
  if (marker) {
    const k = marker[2][2];
    const cands = [marker[2][0], marker[2][1], (k + 1) % 8, (k + 7) % 8, (k + (markerStep ?? 1) + 8) % 8].filter(
      (v) => v !== k,
    );
    markerAlt = rng.pick([...new Set(cands)]);
  }
  const options: FigureSpec[] = [];
  for (let mask = 0; mask < 8; mask++) {
    let els = [...key];
    flips.forEach((e, i) => {
      if (mask & (1 << i)) els = els.includes(e) ? els.filter((x) => x !== e) : sortedSet([...els, e]);
    });
    if (els.length === 0) return null;
    const m = marker ? (mask & (1 << 2) ? markerAlt : marker[2][2]) : null;
    options.push(cellOf(els, m));
  }

  const meanElements = rows.flat().reduce((s, set) => s + set.length, 0) / 9;
  const ruleStrings = [`lines:${rule}`];
  if (recipe.markerRule) ruleStrings.push(`marker:${recipe.markerRule}${markerStep !== undefined ? `(${markerStep > 0 ? "+" : ""}${markerStep})` : ""}`);
  const logit =
    INTERCEPT +
    RULE_WEIGHT[rule] +
    (recipe.markerRule ? RULE_WEIGHT[`marker-${recipe.markerRule}`] + PER_EXTRA_RULE : 0) +
    0.1 * (meanElements - 3);
  const sentences = [LINES_SENTENCE[rule]];
  if (recipe.markerRule === "prog")
    sentences.push(
      `The dot moves ${Math.abs(markerStep!) === 1 ? "one position" : "two positions"} ${markerStep! > 0 ? "clockwise" : "anticlockwise"} around the cell from one column to the next.`,
    );
  if (recipe.markerRule === "dist3") sentences.push("Each row and each column has the dot in the same three positions, each exactly once.");
  return {
    cells,
    options,
    rules: ruleStrings,
    sentences,
    features: {
      template: recipe.markerRule ? "lines+marker" : "lines",
      nRules: ruleStrings.length,
      rules: ruleStrings.join(" "),
      meanElements: Math.round(meanElements * 100) / 100,
    },
    logit,
  };
}

export function generateMatrixItem(recipe: MatrixRecipe, id: string, seed: number, rngFactory: (s: number) => Rng): Item {
  const rng = rngFactory(seed);
  const built = retry(`matrix ${id}`, 500, () => {
    const b = recipe.template === "entity" ? buildEntity(recipe, rng) : buildLines(recipe, rng);
    if (!b) return null;
    // All options must be distinct.
    const keys = new Set(b.options.map((o) => JSON.stringify(o)));
    if (keys.size !== b.options.length) return null;
    // Independent verification.
    const stimulusCells = [...b.cells.slice(0, 8), null];
    const solved = solveMatrix(stimulusCells, b.options);
    if (solved.status !== "unique" || solved.optionIndex !== 0) return null;
    return b;
  });

  const response = choiceResponse(
    rng,
    { type: "figure", figure: built.options[0] },
    built.options.slice(1).map((figure) => ({ type: "figure" as const, figure })),
  );
  const difficulty = makeDifficulty("matrix-complexity@1", built.logit, built.features);
  return {
    id,
    version: 1,
    domain: "Gf",
    narrowAbility: "I",
    family: "matrix",
    practice: false,
    prompt: "Which option completes the pattern?",
    stimulus: { type: "matrix", cells: [...built.cells.slice(0, 8), null] },
    response,
    explanation: `${built.sentences.join(" ")} The missing cell therefore contains ${describeFigure(built.options[0])}.`,
    rules: built.rules,
    difficulty,
    estimatedTimeSec: estimateTime(45, difficulty.level),
    timeLimitSec: 150,
    provenance: { generator: MATRIX_GENERATOR.name, generatorVersion: MATRIX_GENERATOR.version, seed },
  };
}

/** Bank composition: 8 recipes per intended level band. */
export const MATRIX_PLAN: MatrixRecipe[] = [
  // ~ level 1
  { template: "entity", variant: "shapes", entityRules: { count: "prog" } },
  { template: "entity", variant: "shapes", entityRules: { size: "prog" } },
  { template: "entity", variant: "arrow", entityRules: { orientation: "prog" } },
  { template: "entity", variant: "shapes", entityRules: { shape: "const-row" } },
  { template: "entity", variant: "shapes", entityRules: { count: "prog" } },
  { template: "entity", variant: "arrow", entityRules: { orientation: "prog" } },
  { template: "entity", variant: "shapes", entityRules: { size: "prog" } },
  { template: "entity", variant: "shapes", entityRules: { fill: "const-row" } },
  // ~ level 2
  { template: "entity", variant: "shapes", entityRules: { shape: "dist3" } },
  { template: "entity", variant: "shapes", entityRules: { fill: "dist3" } },
  { template: "entity", variant: "shapes", entityRules: { count: "prog", shape: "const-row" } },
  { template: "lines", linesRule: "or" },
  { template: "entity", variant: "arrow", entityRules: { orientation: "prog2", size: "const-row" } },
  { template: "lines", linesRule: "or" },
  { template: "entity", variant: "shapes", entityRules: { count: "add" } },
  { template: "lines", linesRule: "minus" },
  // ~ level 3
  { template: "entity", variant: "shapes", entityRules: { shape: "dist3", count: "prog" } },
  { template: "entity", variant: "shapes", entityRules: { count: "add", shape: "const-row" } },
  { template: "entity", variant: "shapes", entityRules: { fill: "dist3", size: "prog" } },
  { template: "lines", linesRule: "and" },
  { template: "lines", linesRule: "xor" },
  { template: "entity", variant: "arrow", entityRules: { orientation: "dist3", fill: "dist3" } },
  { template: "lines", linesRule: "minus", markerRule: "prog" },
  { template: "entity", variant: "shapes", entityRules: { count: "sub", shape: "dist3" } },
  // ~ level 4
  { template: "entity", variant: "shapes", entityRules: { shape: "dist3", fill: "dist3", count: "prog" } },
  { template: "entity", variant: "arrow", entityRules: { orientation: "prog", fill: "dist3", size: "dist3" } },
  { template: "lines", linesRule: "xor", markerRule: "prog" },
  { template: "lines", linesRule: "and", markerRule: "dist3" },
  { template: "entity", variant: "shapes", entityRules: { shape: "dist3", size: "dist3", fill: "const-row" } },
  { template: "lines", linesRule: "xor", markerRule: "dist3" },
  { template: "entity", variant: "shapes", entityRules: { count: "sub", fill: "dist3", shape: "const-row" } },
  { template: "entity", variant: "arrow", entityRules: { orientation: "prog2", fill: "dist3", size: "prog" } },
  // ~ level 5
  { template: "entity", variant: "shapes", entityRules: { shape: "dist3", fill: "dist3", size: "dist3", count: "prog" } },
  { template: "entity", variant: "shapes", entityRules: { count: "add", fill: "dist3", shape: "dist3" } },
  { template: "entity", variant: "arrow", entityRules: { orientation: "dist3", fill: "dist3", size: "dist3", count: "prog" } },
  { template: "entity", variant: "shapes", entityRules: { count: "sub", fill: "dist3", shape: "dist3", size: "dist3" } },
  { template: "entity", variant: "shapes", entityRules: { shape: "dist3", fill: "dist3", size: "dist3", count: "add" } },
  { template: "entity", variant: "arrow", entityRules: { orientation: "prog", fill: "dist3", size: "dist3", count: "dist3" } },
  { template: "entity", variant: "shapes", entityRules: { shape: "dist3", fill: "dist3", size: "prog", count: "sub" } },
  { template: "entity", variant: "arrow", entityRules: { orientation: "prog2", fill: "dist3", size: "dist3", count: "add" } },
];
