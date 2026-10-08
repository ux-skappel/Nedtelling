/**
 * Quantitative reasoning generators (Gq / CHC RQ).
 *
 *  - Number series: continue a sequence. Free numeric response (no guessing
 *    floor). Only series with a single continuation across the solver's whole
 *    rule library are accepted.
 *  - Balance problems: pictorial weight equations solved by substitution,
 *    i.e. simultaneous linear equations without algebraic notation. Keys are
 *    computed with exact rational Gaussian elimination.
 *  - Number matrices: 3×3 grids whose rows (or columns) share an arithmetic
 *    relation. Validity is checked by brute force: exactly one value for the
 *    missing cell may make *any* relation in the solver's library hold.
 *
 * Arithmetic stays within whole numbers below 1000 and uses only the four
 * basic operations, to limit the influence of formal mathematics education.
 */

import type { Rng } from "../../random";
import { estimateTime, makeDifficulty } from "../difficulty";
import { solveNumberSeries } from "../solvers/numberSeriesSolver";
import { solveBalance } from "../solvers/balanceSolver";
import { solveNumberMatrix } from "../solvers/numberMatrixSolver";
import type { BalanceSide, BalanceSymbol, Item } from "../types";
import { choiceResponse, retry, textOption } from "./common";

export const QUANT_GENERATOR = { name: "quantitative", version: "1.0.0" };

// ---------------------------------------------------------------------------
// Number series
// ---------------------------------------------------------------------------

export type NumberSeriesFamily =
  | "arith-small"
  | "arith-large"
  | "geom2"
  | "geom3"
  | "second-order"
  | "interleaved"
  | "op-cycle"
  | "fibonacci"
  | "diff-geometric"
  | "affine"
  | "interleaved-mixed";

const SERIES_LOGIT: Record<NumberSeriesFamily, number> = {
  "arith-small": -2.1,
  "arith-large": -1.6,
  geom2: -1.1,
  geom3: -0.8,
  "second-order": -0.3,
  interleaved: 0.1,
  "op-cycle": 0.6,
  fibonacci: 0.7,
  "diff-geometric": 1.0,
  affine: 1.2,
  "interleaved-mixed": 1.5,
};

const SERIES_EXPLAIN: Record<NumberSeriesFamily, (p: Record<string, number>) => string> = {
  "arith-small": (p) => `Each number is ${p.d > 0 ? p.d : -p.d} ${p.d > 0 ? "more" : "less"} than the one before.`,
  "arith-large": (p) => `Each number is ${p.d > 0 ? p.d : -p.d} ${p.d > 0 ? "more" : "less"} than the one before.`,
  geom2: () => "Each number is twice the one before.",
  geom3: () => "Each number is three times the one before.",
  "second-order": (p) => `The differences between neighbouring numbers grow by ${p.e} each time (${p.diffs}).`,
  interleaved: () => "Two separate series alternate: the 1st, 3rd, 5th … numbers form one series and the 2nd, 4th, 6th … numbers form another, each changing by a fixed amount.",
  "op-cycle": (p) => `Two operations alternate: ${p.op1}, then ${p.op2}, then ${p.op1} again, and so on.`,
  fibonacci: () => "Each number is the sum of the two numbers before it.",
  "diff-geometric": () => "The differences between neighbouring numbers double each time.",
  affine: (p) => `Each number is ${p.p === 2 ? "twice" : "three times"} the previous number ${p.q > 0 ? `plus ${p.q}` : `minus ${-p.q}`}.`,
  "interleaved-mixed": () => "Two series alternate: one doubles each time, the other increases by a fixed amount.",
};

function seriesTerms(family: NumberSeriesFamily, rng: Rng): { terms: number[]; params: Record<string, number | string> } {
  const n = 7; // 6 shown + answer
  switch (family) {
    case "arith-small":
    case "arith-large": {
      const mag = family === "arith-small" ? rng.int(2, 5) : rng.int(6, 13);
      const d = rng.bool(0.7) ? mag : -mag;
      const start = d > 0 ? rng.int(1, 20) : rng.int(mag * n + 1, mag * n + 30);
      return { terms: Array.from({ length: n }, (_, i) => start + d * i), params: { d } };
    }
    case "geom2": {
      const a = rng.int(1, 6);
      return { terms: Array.from({ length: n }, (_, i) => a * 2 ** i), params: {} };
    }
    case "geom3": {
      const a = rng.int(1, 2);
      return { terms: Array.from({ length: 6 }, (_, i) => a * 3 ** i), params: {} };
    }
    case "second-order": {
      const d0 = rng.int(1, 4);
      const e = rng.int(1, 3);
      const start = rng.int(1, 15);
      const terms = [start];
      for (let i = 1; i < n; i++) terms.push(terms[i - 1] + d0 + e * (i - 1));
      const ds = terms.slice(1, 6).map((x, i) => x - terms[i]);
      return { terms, params: { e, diffs: ds.join(", ") + ", …" } };
    }
    case "interleaved": {
      const a0 = rng.int(1, 20);
      const b0 = rng.int(20, 60);
      const da = rng.int(2, 6);
      let db = -rng.int(2, 6);
      if (db === -da) db -= 1;
      const terms = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? a0 + da * (i / 2) : b0 + db * ((i - 1) / 2)));
      return { terms, params: {} };
    }
    case "op-cycle": {
      const x = rng.int(1, 4);
      const variant = rng.pick(["add-mul", "mul-sub"]);
      const start = rng.int(1, 5);
      const terms = [start];
      for (let i = 1; i < n; i++) {
        const prev = terms[i - 1];
        if (variant === "add-mul") terms.push(i % 2 === 1 ? prev + x : prev * 2);
        else terms.push(i % 2 === 1 ? prev * 2 : prev - x);
      }
      return {
        terms,
        params:
          variant === "add-mul" ? { op1: `add ${x}`, op2: "multiply by 2" } : { op1: "multiply by 2", op2: `subtract ${x}` },
      };
    }
    case "fibonacci": {
      const a = rng.int(1, 6);
      const b = rng.int(a + 1, 9);
      const terms = [a, b];
      for (let i = 2; i < n; i++) terms.push(terms[i - 1] + terms[i - 2]);
      return { terms, params: {} };
    }
    case "diff-geometric": {
      const start = rng.int(1, 20);
      const d0 = rng.int(1, 3);
      const terms = [start];
      for (let i = 1; i < n; i++) terms.push(terms[i - 1] + d0 * 2 ** (i - 1));
      return { terms, params: {} };
    }
    case "affine": {
      const p = rng.pick([2, 3]);
      const q = rng.pick(p === 2 ? [-3, -2, -1, 1, 2, 3] : [-2, -1, 1]);
      const start = rng.int(2, 5);
      const len = p === 2 ? n : 6;
      const terms = [start];
      for (let i = 1; i < len; i++) terms.push(p * terms[i - 1] + q);
      return { terms, params: { p, q } };
    }
    case "interleaved-mixed": {
      const a0 = rng.int(1, 3);
      const b0 = rng.int(5, 20);
      const db = rng.int(3, 9);
      const terms = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? a0 * 2 ** (i / 2) : b0 + db * ((i - 1) / 2)));
      return { terms, params: {} };
    }
  }
}

export function generateNumberSeriesItem(family: NumberSeriesFamily, id: string, seed: number, rngFactory: (s: number) => Rng): Item {
  const rng = rngFactory(seed);
  const built = retry(`number-series ${id}`, 500, () => {
    const { terms, params } = seriesTerms(family, rng);
    const shown = terms.slice(0, -1);
    const answer = terms[terms.length - 1];
    if (terms.some((t) => t < 0 || t > 999)) return null;
    const verdict = solveNumberSeries(shown);
    if (verdict.status !== "unique" || verdict.next !== answer) return null;
    // Reject degenerate draws that a simpler rule also explains (they would
    // be easier than the family's difficulty estimate claims).
    const simpler = family.startsWith("arith") ? [] : family.startsWith("geom") ? ["arithmetic"] : ["arithmetic", "geometric"];
    if (verdict.rules.some((r) => simpler.includes(r))) return null;
    return { shown, answer, params, rules: verdict.rules };
  });
  const logit = SERIES_LOGIT[family] + (built.answer > 200 ? 0.2 : 0);
  const difficulty = makeDifficulty("number-series-complexity@1", logit, { family, maxTerm: Math.max(...built.shown, built.answer) });
  return {
    id,
    version: 1,
    domain: "Gq",
    narrowAbility: "RQ",
    family: "number-series",
    practice: false,
    prompt: "Which number comes next?",
    stimulus: { type: "number-series", terms: built.shown },
    response: { kind: "numeric", correct: built.answer },
    explanation: `${SERIES_EXPLAIN[family](built.params as Record<string, number>)} The next number is ${built.answer}.`,
    rules: [`series:${family}`, `solver:${built.rules.join("+")}`],
    difficulty,
    estimatedTimeSec: estimateTime(35, difficulty.level),
    timeLimitSec: 120,
    provenance: { generator: QUANT_GENERATOR.name, generatorVersion: QUANT_GENERATOR.version, seed },
  };
}

export const NUMBER_SERIES_PLAN: NumberSeriesFamily[] = [
  "arith-small",
  "arith-small",
  "arith-large",
  "arith-large",
  "geom2",
  "geom2",
  "geom3",
  "second-order",
  "second-order",
  "second-order",
  "interleaved",
  "interleaved",
  "op-cycle",
  "op-cycle",
  "op-cycle",
  "fibonacci",
  "fibonacci",
  "diff-geometric",
  "diff-geometric",
  "affine",
  "affine",
  "interleaved-mixed",
  "interleaved-mixed",
  "interleaved-mixed",
  "interleaved-mixed",
  "affine",
];

// ---------------------------------------------------------------------------
// Balance problems
// ---------------------------------------------------------------------------

export type BalanceTemplate = "direct" | "divide" | "both-sides" | "chain" | "mixed" | "chain-mixed" | "four-symbols";

const SYMBOLS: BalanceSymbol[] = ["circle", "triangle", "square", "diamond"];

type Term = [BalanceSymbol, number];
const side = (...terms: Term[]): BalanceSide => ({
  items: terms.filter(([, c]) => c > 0).map(([symbol, count]) => ({ symbol, count })),
});
const sideWeight = (s: BalanceSide, w: Record<string, number>) => s.items.reduce((t, i) => t + i.count * w[i.symbol], 0);

const BALANCE_LOGIT: Record<BalanceTemplate, number> = {
  direct: -1.9,
  divide: -1.2,
  "both-sides": -0.6,
  chain: -0.2,
  mixed: 0.5,
  "chain-mixed": 1.0,
  "four-symbols": 1.6,
};

function buildBalance(template: BalanceTemplate, rng: Rng) {
  const [A, B, C, D] = rng.shuffle(SYMBOLS);
  // unit symbol is the lightest; weights are whole multiples of it
  const w: Record<string, number> = { [A]: 1 };
  w[B] = rng.int(2, 4);
  w[C] = rng.int(2, 5) * (rng.bool() ? 1 : w[B]);
  w[D] = rng.int(2, 3) * w[C];
  const unit = A;
  let equations: { left: BalanceSide; right: BalanceSide }[];
  let query: BalanceSide;
  switch (template) {
    case "direct":
      equations = [{ left: side([B, 1]), right: side([A, w[B]]) }];
      query = side([B, rng.int(2, 3)]);
      break;
    case "divide": {
      const k = rng.int(2, 3);
      equations = [{ left: side([B, k]), right: side([A, k * w[B]]) }];
      query = side([B, 1]);
      break;
    }
    case "both-sides": {
      const extra = rng.int(1, 2);
      equations = [{ left: side([B, 1], [A, extra]), right: side([A, w[B] + extra]) }];
      query = side([B, rng.int(1, 2)]);
      break;
    }
    case "chain": {
      const ratio = w[C] / w[B];
      if (!Number.isInteger(ratio) || ratio < 2) return null;
      equations = [
        { left: side([C, 1]), right: side([B, ratio]) },
        { left: side([B, 1]), right: side([A, w[B]]) },
      ];
      query = side([C, 1]);
      break;
    }
    case "mixed": {
      equations = [
        { left: side([C, 1], [B, 1]), right: side([A, w[C] + w[B]]) },
        { left: side([B, 1]), right: side([A, w[B]]) },
      ];
      query = side([C, rng.int(1, 2)], [B, 1]);
      break;
    }
    case "chain-mixed": {
      // C balances B plus some units; B balances units; query C and B together.
      if (w[C] <= w[B]) return null;
      equations = [
        { left: side([C, 1]), right: side([B, 1], [A, w[C] - w[B]]) },
        { left: side([B, 1]), right: side([A, w[B]]) },
      ];
      query = side([C, 1], [B, 1]);
      break;
    }
    case "four-symbols": {
      const r1 = w[D] / w[C];
      if (!Number.isInteger(r1) || w[C] < w[B]) return null;
      equations = [
        { left: side([D, 1]), right: side([C, r1]) },
        { left: side([C, 1], [A, 1]), right: side([B, 1], [A, w[C] - w[B] + 1]) },
        { left: side([B, 1]), right: side([A, w[B]]) },
      ];
      query = side([D, 1], [B, 1]);
      break;
    }
  }
  if (equations.some((eq) => sideWeight(eq.left, w) !== sideWeight(eq.right, w))) return null;
  if (equations.some((eq) => eq.left.items.length === 0 || eq.right.items.length === 0)) return null;
  const answer = sideWeight(query, w) / w[unit];
  if (!Number.isInteger(answer) || answer > 40) return null;
  return { equations, query, unit, answer, weights: w };
}

export function generateBalanceItem(template: BalanceTemplate, id: string, seed: number, rngFactory: (s: number) => Rng): Item {
  const rng = rngFactory(seed);
  const built = retry(`balance ${id}`, 500, () => {
    const b = buildBalance(template, rng);
    if (!b) return null;
    const solved = solveBalance(b.equations, b.query, b.unit);
    if (solved.status !== "unique" || solved.value !== b.answer) return null;
    return b;
  });
  // Numeric options from a window of five consecutive values that contains
  // the key at a random position (so "pick the middle value" does not work).
  const shift = rng.int(0, 4);
  const low = Math.max(1, built.answer - shift);
  const values = [0, 1, 2, 3, 4].map((i) => low + i);
  const response = choiceResponse(
    rng,
    textOption(String(built.answer)),
    values.filter((x) => x !== built.answer).map((x) => textOption(String(x))),
  );
  const difficulty = makeDifficulty("balance-complexity@1", BALANCE_LOGIT[template], {
    template,
    symbols: new Set(built.equations.flatMap((e) => [...e.left.items, ...e.right.items].map((i) => i.symbol))).size,
    equations: built.equations.length,
  });
  const wdesc = Object.entries(built.weights)
    .filter(([s]) => s !== built.unit)
    .filter(([s]) => built.equations.some((e) => [...e.left.items, ...e.right.items].some((i) => i.symbol === s)) || built.query.items.some((i) => i.symbol === s))
    .map(([s, x]) => `one ${s} weighs as much as ${x} ${built.unit}${x === 1 ? "" : "s"}`);
  return {
    id,
    version: 1,
    domain: "Gq",
    narrowAbility: "RQ",
    family: "balance",
    practice: false,
    prompt: `The scales are balanced. How many ${built.unit}s balance the bottom scale?`,
    stimulus: { type: "balance", equations: built.equations, query: built.query, unit: built.unit },
    response,
    explanation: `Working from the scales by substitution: ${wdesc.join("; ")}. The objects on the bottom scale therefore weigh as much as ${built.answer} ${built.unit}s.`,
    rules: [`balance:${template}`],
    difficulty,
    estimatedTimeSec: estimateTime(40, difficulty.level),
    timeLimitSec: 150,
    provenance: { generator: QUANT_GENERATOR.name, generatorVersion: QUANT_GENERATOR.version, seed },
    verification: { kind: "balance", equations: built.equations, query: built.query, unit: built.unit },
  };
}

export const BALANCE_PLAN: BalanceTemplate[] = [
  "direct",
  "direct",
  "divide",
  "divide",
  "both-sides",
  "both-sides",
  "chain",
  "chain",
  "mixed",
  "mixed",
  "chain-mixed",
  "four-symbols",
  "four-symbols",
  "four-symbols",
  "chain-mixed",
];

// ---------------------------------------------------------------------------
// Number matrices
// ---------------------------------------------------------------------------

export type NumberMatrixTemplate =
  | "sum"
  | "difference"
  | "product"
  | "row-total"
  | "a-plus-2b"
  | "double-sum"
  | "columns-sum"
  | "product-minus"
  | "sum-middle-missing"
  | "product-middle-missing";

const NM_LOGIT: Record<NumberMatrixTemplate, number> = {
  sum: -1.9,
  difference: -1.6,
  product: -1.0,
  "row-total": -0.6,
  "columns-sum": -0.4,
  "a-plus-2b": 0.1,
  "double-sum": 0.2,
  "sum-middle-missing": 0.4,
  "product-minus": 1.1,
  "product-middle-missing": 1.3,
};

const NM_EXPLAIN: Record<NumberMatrixTemplate, string> = {
  sum: "In each row, the third number is the sum of the first two.",
  difference: "In each row, the third number is the first number minus the second.",
  product: "In each row, the third number is the product of the first two.",
  "row-total": "The three numbers in every row add up to the same total.",
  "columns-sum": "In each column, the bottom number is the sum of the two numbers above it.",
  "a-plus-2b": "In each row, the third number is the first number plus twice the second.",
  "double-sum": "In each row, the third number is twice the sum of the first two.",
  "sum-middle-missing": "In each row, the third number is the sum of the first two, so the missing number is the third number minus the first.",
  "product-minus": "In each row, the third number is the product of the first two minus the first number.",
  "product-middle-missing": "In each row, the third number is the product of the first two, so the missing number is the third number divided by the first.",
};

function buildNumberMatrix(t: NumberMatrixTemplate, rng: Rng): { cells: number[]; missing: number } | null {
  const rows: number[][] = [];
  const total = rng.int(15, 30);
  for (let r = 0; r < 3; r++) {
    let a = rng.int(2, 12);
    let b = rng.int(2, 12);
    let c: number;
    switch (t) {
      case "sum":
      case "sum-middle-missing":
        c = a + b;
        break;
      case "difference":
        a = rng.int(10, 30);
        b = rng.int(2, a - 2);
        c = a - b;
        break;
      case "product":
      case "product-middle-missing":
        a = rng.int(2, 9);
        b = rng.int(2, 9);
        c = a * b;
        break;
      case "row-total":
        a = rng.int(2, total - 8);
        b = rng.int(2, total - a - 2);
        c = total - a - b;
        break;
      case "a-plus-2b":
        c = a + 2 * b;
        break;
      case "double-sum":
        a = rng.int(2, 9);
        b = rng.int(2, 9);
        c = 2 * (a + b);
        break;
      case "product-minus":
        a = rng.int(2, 8);
        b = rng.int(3, 9);
        c = a * b - a;
        break;
      case "columns-sum":
        c = rng.int(2, 12); // the bottom row is replaced by column sums below
        break;
    }
    rows.push([a, b, c]);
  }
  if (t === "columns-sum") {
    for (let c = 0; c < 3; c++) rows[2][c] = rows[0][c] + rows[1][c];
  }
  const cells = rows.flat();
  const missing = t === "sum-middle-missing" || t === "product-middle-missing" ? 7 : 8;
  if (new Set(rows.map((r) => r.join(","))).size < 3) return null;
  return { cells, missing };
}

export function generateNumberMatrixItem(template: NumberMatrixTemplate, id: string, seed: number, rngFactory: (s: number) => Rng): Item {
  const rng = rngFactory(seed);
  const built = retry(`number-matrix ${id}`, 1000, () => {
    const b = buildNumberMatrix(template, rng);
    if (!b) return null;
    const shown = b.cells.map((x, i) => (i === b.missing ? null : x));
    const verdict = solveNumberMatrix(shown);
    if (verdict.status !== "unique" || verdict.value !== b.cells[b.missing]) return null;
    return { shown, answer: b.cells[b.missing], rules: verdict.rules };
  });
  const difficulty = makeDifficulty("number-matrix-complexity@1", NM_LOGIT[template], { template });
  return {
    id,
    version: 1,
    domain: "Gq",
    narrowAbility: "RQ",
    family: "number-matrix",
    practice: false,
    prompt: "Which number belongs in the empty cell?",
    stimulus: { type: "number-matrix", cells: built.shown },
    response: { kind: "numeric", correct: built.answer },
    explanation: `${NM_EXPLAIN[template]} The missing number is ${built.answer}.`,
    rules: [`number-matrix:${template}`, `solver:${built.rules.join("+")}`],
    difficulty,
    estimatedTimeSec: estimateTime(40, difficulty.level),
    timeLimitSec: 120,
    provenance: { generator: QUANT_GENERATOR.name, generatorVersion: QUANT_GENERATOR.version, seed },
  };
}

export const NUMBER_MATRIX_PLAN: NumberMatrixTemplate[] = [
  "sum",
  "difference",
  "product",
  "row-total",
  "columns-sum",
  "a-plus-2b",
  "double-sum",
  "sum-middle-missing",
  "product-minus",
  "product-middle-missing",
  "product",
  "a-plus-2b",
];
