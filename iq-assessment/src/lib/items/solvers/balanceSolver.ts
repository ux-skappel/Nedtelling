/**
 * Exact solver for balance problems: each scale is a linear equation in the
 * symbol weights; the unit symbol's weight is fixed at 1. Solved by Gaussian
 * elimination over the rationals. The query is accepted only if every symbol
 * it uses has a uniquely determined weight.
 */

import type { BalanceSide } from "../types";

type Frac = [bigint, bigint]; // numerator, denominator (> 0)

const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a || 1n;
};
const norm = ([n, d]: Frac): Frac => {
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcd(n, d);
  return [n / g, d / g];
};
const F = (n: number): Frac => [BigInt(n), 1n];
const add = (a: Frac, b: Frac) => norm([a[0] * b[1] + b[0] * a[1], a[1] * b[1]]);
const sub = (a: Frac, b: Frac) => norm([a[0] * b[1] - b[0] * a[1], a[1] * b[1]]);
const mul = (a: Frac, b: Frac) => norm([a[0] * b[0], a[1] * b[1]]);
const div = (a: Frac, b: Frac) => norm([a[0] * b[1], a[1] * b[0]]);
const isZero = (a: Frac) => a[0] === 0n;

export type BalanceVerdict =
  | { status: "unique"; value: number; weights: Record<string, number> }
  | { status: "inconsistent" | "underdetermined" | "non-integer" };

export function solveBalance(
  equations: { left: BalanceSide; right: BalanceSide }[],
  query: BalanceSide,
  unit: string,
): BalanceVerdict {
  const symbols = [...new Set(equations.flatMap((e) => [...e.left.items, ...e.right.items].map((i) => i.symbol)))]
    .filter((s) => s !== unit)
    .sort();
  const col = new Map(symbols.map((s, i) => [s, i]));
  // Row: Σ coef·w = rhs, with the unit's terms moved to the right-hand side.
  const rows: Frac[][] = equations.map((eq) => {
    const row: Frac[] = symbols.map(() => F(0));
    let rhs = F(0);
    for (const [items, sign] of [
      [eq.left.items, 1],
      [eq.right.items, -1],
    ] as const) {
      for (const it of items) {
        if (it.symbol === unit) rhs = sub(rhs, F(sign * it.count));
        else row[col.get(it.symbol)!] = add(row[col.get(it.symbol)!], F(sign * it.count));
      }
    }
    return [...row, rhs];
  });

  // Reduced row echelon form.
  const n = symbols.length;
  const pivotOf: number[] = [];
  let r = 0;
  for (let c = 0; c < n && r < rows.length; c++) {
    const p = rows.findIndex((row, i) => i >= r && !isZero(row[c]));
    if (p < 0) continue;
    [rows[r], rows[p]] = [rows[p], rows[r]];
    const pv = rows[r][c];
    rows[r] = rows[r].map((x) => div(x, pv));
    for (let i = 0; i < rows.length; i++) {
      if (i === r || isZero(rows[i][c])) continue;
      const f = rows[i][c];
      rows[i] = rows[i].map((x, j) => sub(x, mul(f, rows[r][j])));
    }
    pivotOf[c] = r;
    r++;
  }
  // Inconsistency: a zero row with non-zero right-hand side.
  if (rows.some((row) => row.slice(0, n).every(isZero) && !isZero(row[n]))) return { status: "inconsistent" };

  const weights: Record<string, Frac> = { [unit]: F(1) };
  for (const s of symbols) {
    const c = col.get(s)!;
    const pr = pivotOf[c];
    if (pr === undefined) continue;
    const others = rows[pr].slice(0, n).some((x, j) => j !== c && !isZero(x));
    if (!others) weights[s] = rows[pr][n];
  }
  let total = F(0);
  for (const it of query.items) {
    const w = weights[it.symbol];
    if (!w) return { status: "underdetermined" };
    total = add(total, mul(w, F(it.count)));
  }
  if (total[1] !== 1n) return { status: "non-integer" };
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(weights)) out[k] = Number(v[0]) / Number(v[1]);
  return { status: "unique", value: Number(total[0]), weights: out };
}
