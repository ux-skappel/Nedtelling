/**
 * Independent matrix solver used to verify generated items.
 *
 * It knows nothing about how an item was generated. It decomposes each cell
 * into attribute values, tries every rule in its (deliberately larger) rule
 * set row-wise *and* column-wise, and collects the prediction of every rule
 * consistent with the eight visible cells. An item is accepted only if
 *
 *   1. every attribute has at least one consistent rule,
 *   2. all consistent rules agree on the missing value (no alternative
 *      reading of the matrix leads to a different answer), and
 *   3. exactly one answer option has the predicted value for every attribute.
 */

import { setOps } from "../figures";
import type { FigureSpec } from "../types";

type Value = number | string | number[];
type Kind = "categorical" | "ordinal" | "cyclic8" | "set";

const KINDS: Record<string, Kind> = {
  "entity.shape": "categorical",
  "entity.fill": "categorical",
  "entity.large": "categorical",
  "entity.count": "ordinal",
  "entity.size": "ordinal",
  "entity.orientation": "cyclic8",
  "marker.position": "cyclic8",
  "marker.shape": "categorical",
  lines: "set",
};

export function extractAttributes(fig: FigureSpec): Map<string, Value> {
  const out = new Map<string, Value>();
  for (const layer of fig.layers) {
    if (layer.kind === "entity") {
      out.set("entity.shape", layer.shape);
      out.set("entity.fill", layer.fill);
      out.set("entity.large", layer.large ? "large" : "normal");
      out.set("entity.count", layer.count);
      out.set("entity.size", layer.size);
      out.set("entity.orientation", layer.orientation);
    } else if (layer.kind === "lines") {
      out.set("lines", [...layer.elements].sort((a, b) => a - b));
    } else {
      out.set("marker.position", layer.position);
      out.set("marker.shape", layer.shape);
    }
  }
  return out;
}

const keyOf = (v: Value) => (Array.isArray(v) ? `[${v.join(",")}]` : String(v));
const eq = (a: Value, b: Value) => keyOf(a) === keyOf(b);

type G = Value[][]; // [row][col], g[2][2] unused

function rowConstant(g: G): Value | null {
  for (const r of [0, 1]) if (!(eq(g[r][0], g[r][1]) && eq(g[r][1], g[r][2]))) return null;
  return eq(g[2][0], g[2][1]) ? g[2][0] : null;
}

function latin(g: G): Value | null {
  const rowSet = (r: number) => new Set([0, 1, 2].map((c) => keyOf(g[r][c])));
  const s0 = rowSet(0);
  const s1 = rowSet(1);
  if (s0.size !== 3 || s1.size !== 3) return null;
  for (const k of s0) if (!s1.has(k)) return null;
  for (const c of [0, 1, 2]) if (eq(g[0][c], g[1][c])) return null;
  const k20 = keyOf(g[2][0]);
  const k21 = keyOf(g[2][1]);
  if (k20 === k21 || !s0.has(k20) || !s0.has(k21)) return null;
  if (eq(g[2][0], g[0][0]) || eq(g[2][0], g[1][0]) || eq(g[2][1], g[0][1]) || eq(g[2][1], g[1][1])) return null;
  const remaining = [0, 1, 2].map((c) => g[0][c]).find((v) => keyOf(v) !== k20 && keyOf(v) !== k21)!;
  if (eq(remaining, g[0][2]) || eq(remaining, g[1][2])) return null;
  return remaining;
}

function binary(g: G, f: (a: Value, b: Value) => Value | null): Value | null {
  for (const r of [0, 1]) {
    const out = f(g[r][0], g[r][1]);
    if (out === null || !eq(out, g[r][2])) return null;
  }
  return f(g[2][0], g[2][1]);
}

function progression(g: G, mod: number | null): Value | null {
  const diff = (a: number, b: number) => (mod ? (((b - a) % mod) + mod) % mod : b - a);
  const nums = g.map((row) => row.map((v) => v as number));
  const d = diff(nums[0][0], nums[0][1]);
  if (d === 0) return null;
  for (const r of [0, 1]) {
    if (diff(nums[r][0], nums[r][1]) !== d || diff(nums[r][1], nums[r][2]) !== d) return null;
  }
  if (diff(nums[2][0], nums[2][1]) !== d) return null;
  const next = nums[2][1] + d;
  return mod ? ((next % mod) + mod) % mod : next;
}

function predictionsFor(kind: Kind, g: G): Value[] {
  const preds: (Value | null)[] = [rowConstant(g), latin(g)];
  if (kind === "ordinal") {
    preds.push(progression(g, null));
    preds.push(binary(g, (a, b) => (a as number) + (b as number)));
    preds.push(binary(g, (a, b) => (a as number) - (b as number)));
    preds.push(binary(g, (a, b) => (a as number) * (b as number)));
  }
  if (kind === "cyclic8") preds.push(progression(g, 8));
  if (kind === "set") {
    const asSet = (v: Value) => v as number[];
    preds.push(binary(g, (a, b) => setOps.or(asSet(a), asSet(b))));
    preds.push(binary(g, (a, b) => setOps.and(asSet(a), asSet(b))));
    preds.push(binary(g, (a, b) => setOps.xor(asSet(a), asSet(b))));
    preds.push(binary(g, (a, b) => setOps.minus(asSet(a), asSet(b))));
    preds.push(binary(g, (a, b) => setOps.minus(asSet(b), asSet(a))));
  }
  return preds.filter((p): p is Value => p !== null);
}

export type MatrixSolution =
  | { status: "unique"; optionIndex: number; predicted: Record<string, string> }
  | { status: "structure" | "no-rule" | "ambiguous" | "no-match" | "multiple-match"; detail: string };

export function solveMatrix(cells: (FigureSpec | null)[], options: FigureSpec[]): MatrixSolution {
  if (cells.length !== 9 || cells[8] !== null || cells.slice(0, 8).some((c) => c === null)) {
    return { status: "structure", detail: "Expected 8 visible cells and a missing ninth." };
  }
  const attrs = cells.slice(0, 8).map((c) => extractAttributes(c!));
  const names = [...attrs[0].keys()].sort();
  for (const a of attrs) {
    if (keyOf([...a.keys()].sort().join("|")) !== keyOf(names.join("|"))) {
      return { status: "structure", detail: "Cells do not share the same layer structure." };
    }
  }

  const predicted: Record<string, Value> = {};
  for (const name of names) {
    const kind = KINDS[name];
    if (!kind) return { status: "structure", detail: `Unknown attribute ${name}` };
    const g: G = [0, 1, 2].map((r) => [0, 1, 2].map((c) => (r === 2 && c === 2 ? 0 : attrs[r * 3 + c].get(name)!)));
    const t: G = [0, 1, 2].map((r) => [0, 1, 2].map((c) => g[c][r]));
    const preds = [...predictionsFor(kind, g), ...predictionsFor(kind, t)];
    if (preds.length === 0) return { status: "no-rule", detail: `No rule explains ${name}.` };
    const distinct = [...new Set(preds.map(keyOf))];
    if (distinct.length > 1) {
      return { status: "ambiguous", detail: `${name} has competing answers: ${distinct.join(" vs ")}` };
    }
    predicted[name] = preds[0];
  }

  const matches = options
    .map((opt, i) => ({ i, a: extractAttributes(opt) }))
    .filter(({ a }) => names.every((n) => a.has(n) && eq(a.get(n)!, predicted[n])) && a.size === names.length);
  if (matches.length === 0) return { status: "no-match", detail: "No option matches the predicted cell." };
  if (matches.length > 1) return { status: "multiple-match", detail: "More than one option matches." };
  return {
    status: "unique",
    optionIndex: matches[0].i,
    predicted: Object.fromEntries(Object.entries(predicted).map(([k, v]) => [k, keyOf(v)])),
  };
}
