/**
 * Independent number-series solver.
 *
 * Any finite sequence can be continued in infinitely many ways, so a number
 * series item is only fair if the intended continuation is the one given by
 * every *simple* rule that fits the visible terms. This solver tries a broad
 * library of simple rules and reports every continuation they produce. An
 * item is accepted only if the library yields exactly one continuation.
 */

export interface RuleFit {
  rule: string;
  next: number;
}

const isInt = (x: number) => Number.isFinite(x) && Math.abs(x - Math.round(x)) < 1e-9;
const diffs = (t: number[]) => t.slice(1).map((x, i) => x - t[i]);
const allEqual = (xs: number[]) => xs.length > 0 && xs.every((x) => Math.abs(x - xs[0]) < 1e-9);

function arithmetic(t: number[]): number | null {
  const d = diffs(t);
  return d.length >= 2 && allEqual(d) ? t[t.length - 1] + d[0] : null;
}

function geometric(t: number[]): number | null {
  if (t.some((x) => x === 0)) return null;
  const r = t[1] / t[0];
  if (r === 1) return null;
  for (let i = 1; i < t.length; i++) if (Math.abs(t[i] - t[i - 1] * r) > 1e-9) return null;
  const next = t[t.length - 1] * r;
  return isInt(next) ? Math.round(next) : null;
}

function polynomial(t: number[], order: number): number | null {
  let level = t;
  const lasts: number[] = [];
  for (let k = 0; k < order; k++) {
    lasts.push(level[level.length - 1]);
    level = diffs(level);
  }
  if (level.length < 2 || !allEqual(level) || level[0] === 0) return null;
  // Rebuild the next term: last of each difference level plus the next difference.
  let next = level[0];
  for (let k = order - 1; k >= 0; k--) next = lasts[k] + next;
  return next;
}

function differencesGeometric(t: number[]): number | null {
  const d = diffs(t);
  if (d.length < 3) return null;
  const g = geometric(d);
  return g === null ? null : t[t.length - 1] + g;
}

/** t[n+1] = p·t[n] + q with integer p, q. */
function affine(t: number[]): number | null {
  if (t.length < 4) return null;
  const [a, b, c] = t;
  if (b === a) return null;
  const p = (c - b) / (b - a);
  const q = b - p * a;
  if (!isInt(p) || !isInt(q) || p === 1 || p === 0) return null;
  for (let i = 1; i < t.length; i++) if (t[i] !== p * t[i - 1] + q) return null;
  return p * t[t.length - 1] + q;
}

/** t[n+2] = α·t[n+1] + β·t[n] with small integer α, β (includes Fibonacci). */
function linearRecurrence2(t: number[]): number | null {
  if (t.length < 5) return null;
  for (let alpha = -3; alpha <= 3; alpha++)
    for (let beta = -3; beta <= 3; beta++) {
      if (beta === 0) continue; // first-order cases are covered elsewhere
      let ok = true;
      for (let i = 2; i < t.length && ok; i++) ok = t[i] === alpha * t[i - 1] + beta * t[i - 2];
      if (ok) return alpha * t[t.length - 1] + beta * t[t.length - 2];
    }
  return null;
}

/** Two interleaved subsequences, each arithmetic or geometric. */
function interleaved(t: number[]): number[] {
  if (t.length < 6) return [];
  const even = t.filter((_, i) => i % 2 === 0);
  const odd = t.filter((_, i) => i % 2 === 1);
  const nextSub = t.length % 2 === 0 ? even : odd;
  const other = t.length % 2 === 0 ? odd : even;
  const otherFits = arithmetic(other) !== null || geometric(other) !== null || allEqual(other);
  if (!otherFits) return [];
  const out: number[] = [];
  for (const f of [arithmetic, geometric]) {
    const n = f(nextSub);
    if (n !== null) out.push(n);
  }
  if (allEqual(nextSub)) out.push(nextSub[0]);
  return out;
}

type Op = { kind: "+" | "×"; k: number };
function opsFor(a: number, b: number): Op[] {
  const out: Op[] = [{ kind: "+", k: b - a }];
  if (a !== 0 && isInt(b / a) && b / a !== 1) out.push({ kind: "×", k: b / a });
  return out;
}
const applyOp = (x: number, op: Op) => (op.kind === "+" ? x + op.k : x * op.k);

/** Alternating pair of operations (e.g. +3, ×2, +3, ×2, …). */
function operationCycle(t: number[]): number[] {
  if (t.length < 5) return [];
  const out: number[] = [];
  for (const op1 of opsFor(t[0], t[1]))
    for (const op2 of opsFor(t[1], t[2])) {
      if (op1.kind === op2.kind && op1.k === op2.k) continue; // that is a plain progression
      let ok = true;
      for (let i = 1; i < t.length && ok; i++) ok = applyOp(t[i - 1], i % 2 === 1 ? op1 : op2) === t[i];
      if (ok) out.push(applyOp(t[t.length - 1], t.length % 2 === 1 ? op1 : op2));
    }
  return out;
}

/** Multiply by a factor that grows by one each step (×2, ×3, ×4, …). */
function growingFactor(t: number[]): number | null {
  if (t.length < 4 || t[0] === 0) return null;
  const f0 = t[1] / t[0];
  if (!isInt(f0)) return null;
  for (let i = 1; i < t.length; i++) if (t[i] !== t[i - 1] * (f0 + i - 1)) return null;
  return t[t.length - 1] * (f0 + t.length - 1);
}

export function fitNumberSeries(terms: number[]): RuleFit[] {
  const fits: RuleFit[] = [];
  const push = (rule: string, next: number | null) => {
    if (next !== null && isInt(next)) fits.push({ rule, next: Math.round(next) });
  };
  push("arithmetic", arithmetic(terms));
  push("geometric", geometric(terms));
  push("second-order", polynomial(terms, 2));
  push("third-order", polynomial(terms, 3));
  push("differences-geometric", differencesGeometric(terms));
  push("affine-recurrence", affine(terms));
  push("linear-recurrence-2", linearRecurrence2(terms));
  push("growing-factor", growingFactor(terms));
  for (const n of interleaved(terms)) push("interleaved", n);
  for (const n of operationCycle(terms)) push("operation-cycle", n);
  return fits;
}

export type SeriesVerdict =
  | { status: "unique"; next: number; rules: string[] }
  | { status: "no-rule" }
  | { status: "ambiguous"; continuations: number[] };

export function solveNumberSeries(terms: number[]): SeriesVerdict {
  const fits = fitNumberSeries(terms);
  if (fits.length === 0) return { status: "no-rule" };
  const values = [...new Set(fits.map((f) => f.next))];
  if (values.length > 1) return { status: "ambiguous", continuations: values };
  return { status: "unique", next: values[0], rules: fits.map((f) => f.rule) };
}
