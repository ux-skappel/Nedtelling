/**
 * Paper-folding geometry, shared by the generator, its verifier and the
 * renderer.
 *
 * Coordinates are integer "half-units": the square sheet spans 0..16 on both
 * axes (y grows downwards); hole positions are the centres of an 8×8 grid,
 * i.e. odd coordinates 1..15. Every reflection used below maps grid centres to
 * grid centres, so all computations are exact.
 */

import type { FoldKind } from "./types";

export const SHEET = 16;

export interface Region {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** After a diagonal fold only a triangle remains. */
  tri: null | "upper-right" | "upper-left";
}

export type Pt = [number, number];

export const FULL_SHEET: Region = { x0: 0, x1: SHEET, y0: 0, y1: SHEET, tri: null };

export interface FoldStep {
  before: Region;
  after: Region;
  kind: FoldKind;
  /** Fold line endpoints. */
  line: [Pt, Pt];
  /** Maps a point on the moving flap onto the stationary part (and vice versa). */
  reflect: (p: Pt) => Pt;
}

export function canFold(region: Region, kind: FoldKind): boolean {
  if (region.tri) return false;
  const w = region.x1 - region.x0;
  const h = region.y1 - region.y0;
  if (kind === "diag-main" || kind === "diag-anti") return w === h && w >= 4;
  if (kind === "left-over-right" || kind === "right-over-left") return w >= 4;
  return h >= 4;
}

export function applyFold(region: Region, kind: FoldKind): FoldStep {
  if (!canFold(region, kind)) throw new Error(`Cannot fold ${kind} on region ${JSON.stringify(region)}`);
  const { x0, x1, y0, y1 } = region;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const s = x1 - x0;
  switch (kind) {
    case "left-over-right":
      return { before: region, kind, after: { ...region, x0: mx }, line: [[mx, y0], [mx, y1]], reflect: ([x, y]) => [2 * mx - x, y] };
    case "right-over-left":
      return { before: region, kind, after: { ...region, x1: mx }, line: [[mx, y0], [mx, y1]], reflect: ([x, y]) => [2 * mx - x, y] };
    case "top-over-bottom":
      return { before: region, kind, after: { ...region, y0: my }, line: [[x0, my], [x1, my]], reflect: ([x, y]) => [x, 2 * my - y] };
    case "bottom-over-top":
      return { before: region, kind, after: { ...region, y1: my }, line: [[x0, my], [x1, my]], reflect: ([x, y]) => [x, 2 * my - y] };
    case "diag-main":
      // Fold the lower-left triangle up onto the upper-right one.
      return {
        before: region,
        kind,
        after: { ...region, tri: "upper-right" },
        line: [[x0, y0], [x1, y1]],
        reflect: ([x, y]) => [x0 + (y - y0), y0 + (x - x0)],
      };
    case "diag-anti":
      // Fold the lower-right triangle up onto the upper-left one.
      return {
        before: region,
        kind,
        after: { ...region, tri: "upper-left" },
        line: [[x1, y0], [x0, y1]],
        reflect: ([x, y]) => [x0 + s - (y - y0), y0 + s - (x - x0)],
      };
  }
}

export function foldSequence(folds: readonly FoldKind[]): FoldStep[] {
  const steps: FoldStep[] = [];
  let region = FULL_SHEET;
  for (const f of folds) {
    const step = applyFold(region, f);
    steps.push(step);
    region = step.after;
  }
  return steps;
}

/** Strictly inside the region (not on its border or the fold line). */
export function strictlyInside(region: Region, [x, y]: Pt): boolean {
  if (!(x > region.x0 && x < region.x1 && y > region.y0 && y < region.y1)) return false;
  const dx = x - region.x0;
  const dy = y - region.y0;
  const s = region.x1 - region.x0;
  if (region.tri === "upper-right") return dy < dx;
  if (region.tri === "upper-left") return dx + dy < s;
  return true;
}

export function regionPolygon(region: Region): Pt[] {
  const { x0, x1, y0, y1, tri } = region;
  if (tri === "upper-right") return [[x0, y0], [x1, y0], [x1, y1]];
  if (tri === "upper-left") return [[x0, y0], [x1, y0], [x0, y1]];
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

const keyPt = ([x, y]: Pt) => `${x},${y}`;

export function sortPts(pts: Iterable<Pt>): Pt[] {
  const uniq = new Map<string, Pt>();
  for (const p of pts) uniq.set(keyPt(p), p);
  return [...uniq.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/**
 * Unfold: a hole punched through the folded paper appears at every point
 * that the folds map onto the punch position. Unfolding the last fold first,
 * each fold adds the mirror image of the holes found so far.
 */
export function unfold(folds: readonly FoldKind[], punches: readonly Pt[], skip: ReadonlySet<number> = new Set()): Pt[] {
  const steps = foldSequence(folds);
  let holes = sortPts(punches);
  for (let i = steps.length - 1; i >= 0; i--) {
    if (skip.has(i)) continue;
    holes = sortPts([...holes, ...holes.map(steps[i].reflect)]);
  }
  return holes;
}

export function samePattern(a: readonly Pt[], b: readonly Pt[]): boolean {
  const ka = sortPts(a).map(keyPt).join(";");
  const kb = sortPts(b).map(keyPt).join(";");
  return ka === kb;
}

/** Convert half-unit points to 0..1 paper coordinates (and back). */
export const toUnit = ([x, y]: Pt): [number, number] => [x / SHEET, y / SHEET];
export const fromUnit = ([x, y]: [number, number]): Pt => [Math.round(x * SHEET), Math.round(y * SHEET)];
