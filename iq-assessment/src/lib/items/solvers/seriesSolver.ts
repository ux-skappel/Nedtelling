/**
 * Independent solver for figure series. Each attribute's six visible values
 * are tested against a library of sequence rules (a superset of the ones the
 * generator uses). Every consistent rule votes for the seventh value; the item
 * is valid only if all votes agree and exactly one option matches.
 */

import type { FigureSpec } from "../types";
import { extractAttributes } from "./matrixSolver";

type Value = number | string | number[];
const keyOf = (v: Value) => (Array.isArray(v) ? `[${v.join(",")}]` : String(v));

const CYCLIC8 = new Set(["entity.orientation", "marker.position"]);
const ORDINAL = new Set(["entity.count", "entity.size"]);

const mod = (x: number, n: number) => ((x % n) + n) % n;

function predictions(name: string, vs: Value[]): Value[] {
  const out: Value[] = [];
  const n = vs.length; // 6
  const k = vs.map(keyOf);
  // constant
  if (k.every((x) => x === k[0])) out.push(vs[0]);
  // period 2
  if (k.every((x, i) => x === k[i % 2])) out.push(vs[n % 2]);
  // period 3
  if (k.every((x, i) => x === k[i % 3])) out.push(vs[n % 3]);

  if (CYCLIC8.has(name) || ORDINAL.has(name)) {
    const nums = vs as number[];
    const wrap = CYCLIC8.has(name) ? (x: number) => mod(x, 8) : (x: number) => x;
    const diff = (a: number, b: number) => (CYCLIC8.has(name) ? mod(b - a, 8) : b - a);
    // arithmetic / cyclic progression
    const d = diff(nums[0], nums[1]);
    if (nums.every((x, i) => i === 0 || diff(nums[i - 1], x) === d)) out.push(wrap(nums[n - 1] + d));
    // two interleaved progressions (positions 0,2,4,… and 1,3,5,…)
    const evens = nums.filter((_, i) => i % 2 === 0);
    const odds = nums.filter((_, i) => i % 2 === 1);
    const de = diff(evens[0], evens[1]);
    const dodd = diff(odds[0], odds[1]);
    const evensOk = evens.every((x, i) => i === 0 || diff(evens[i - 1], x) === de);
    const oddsOk = odds.every((x, i) => i === 0 || diff(odds[i - 1], x) === dodd);
    if (evensOk && oddsOk) out.push(n % 2 === 0 ? wrap(evens[evens.length - 1] + de) : wrap(odds[odds.length - 1] + dodd));
    // accelerating progression: successive steps change by a constant amount
    const steps = nums.slice(1).map((x, i) => diff(nums[i], x));
    const inc = CYCLIC8.has(name) ? mod(steps[1] - steps[0], 8) : steps[1] - steps[0];
    const incOk = steps.every((s, i) => i === 0 || (CYCLIC8.has(name) ? mod(s - steps[i - 1], 8) : s - steps[i - 1]) === inc);
    if (inc !== 0 && incOk) out.push(wrap(nums[n - 1] + steps[steps.length - 1] + inc));
  }
  return out;
}

export type SeriesSolution =
  | { status: "unique"; optionIndex: number }
  | { status: "structure" | "no-rule" | "ambiguous" | "no-match" | "multiple-match"; detail: string };

export function solveSeries(panels: FigureSpec[], options: FigureSpec[]): SeriesSolution {
  const attrs = panels.map(extractAttributes);
  const names = [...attrs[0].keys()].sort();
  if (attrs.some((a) => [...a.keys()].sort().join("|") !== names.join("|"))) {
    return { status: "structure", detail: "Panels differ in structure" };
  }
  const predicted: Record<string, string> = {};
  for (const name of names) {
    const preds = predictions(
      name,
      attrs.map((a) => a.get(name)!),
    );
    if (preds.length === 0) return { status: "no-rule", detail: `No rule explains ${name}` };
    const distinct = [...new Set(preds.map(keyOf))];
    if (distinct.length > 1) return { status: "ambiguous", detail: `${name}: ${distinct.join(" vs ")}` };
    predicted[name] = distinct[0];
  }
  const matches = options
    .map((o, i) => ({ i, a: extractAttributes(o) }))
    .filter(({ a }) => a.size === names.length && names.every((n) => a.has(n) && keyOf(a.get(n)!) === predicted[n]));
  if (matches.length === 0) return { status: "no-match", detail: "No option matches" };
  if (matches.length > 1) return { status: "multiple-match", detail: "Several options match" };
  return { status: "unique", optionIndex: matches[0].i };
}
