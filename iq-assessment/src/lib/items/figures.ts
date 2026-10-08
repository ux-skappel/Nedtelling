/**
 * Shared vocabulary for figural items (matrices and figure series): the line
 * elements used by superimposition rules, marker positions and plain-language
 * descriptions used in explanations. Geometry is in a 0..100 cell.
 */

import type { EntityLayer, FigureSpec, FillKind, ShapeKind } from "./types";

export type LineElement =
  | { id: number; name: string; kind: "line"; x1: number; y1: number; x2: number; y2: number }
  | { id: number; name: string; kind: "circle"; cx: number; cy: number; r: number };

export const LINE_ELEMENTS: LineElement[] = [
  { id: 0, name: "top edge", kind: "line", x1: 22, y1: 22, x2: 78, y2: 22 },
  { id: 1, name: "right edge", kind: "line", x1: 78, y1: 22, x2: 78, y2: 78 },
  { id: 2, name: "bottom edge", kind: "line", x1: 22, y1: 78, x2: 78, y2: 78 },
  { id: 3, name: "left edge", kind: "line", x1: 22, y1: 22, x2: 22, y2: 78 },
  { id: 4, name: "falling diagonal", kind: "line", x1: 22, y1: 22, x2: 78, y2: 78 },
  { id: 5, name: "rising diagonal", kind: "line", x1: 22, y1: 78, x2: 78, y2: 22 },
  { id: 6, name: "vertical centre line", kind: "line", x1: 50, y1: 22, x2: 50, y2: 78 },
  { id: 7, name: "horizontal centre line", kind: "line", x1: 22, y1: 50, x2: 78, y2: 50 },
  { id: 8, name: "small circle", kind: "circle", cx: 50, cy: 50, r: 9 },
  { id: 9, name: "large circle", kind: "circle", cx: 50, cy: 50, r: 22 },
];

export const MARKER_RADIUS = 43;

export function markerPoint(position: number): [number, number] {
  const angle = (position * Math.PI) / 4;
  return [50 + MARKER_RADIUS * Math.sin(angle), 50 - MARKER_RADIUS * Math.cos(angle)];
}

export const POSITION_NAMES = ["top", "top right", "right", "bottom right", "bottom", "bottom left", "left", "top left"];
export const DIRECTION_NAMES = ["up", "up-right", "right", "down-right", "down", "down-left", "left", "up-left"];

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six"];
const SIZE_WORDS = ["small", "medium", "large"];

const SHAPE_PLURALS: Record<ShapeKind, string> = {
  circle: "circles",
  square: "squares",
  triangle: "triangles",
  diamond: "diamonds",
  pentagon: "pentagons",
  hexagon: "hexagons",
  star: "stars",
  cross: "crosses",
  arrow: "arrows",
};

const FILL_WORDS: Record<FillKind, string> = { outline: "white", striped: "striped", solid: "black" };

export function describeEntity(e: EntityLayer): string {
  const noun = e.count === 1 ? e.shape : SHAPE_PLURALS[e.shape];
  const count = NUMBER_WORDS[e.count] ?? String(e.count);
  const dir = e.shape === "arrow" ? ` pointing ${DIRECTION_NAMES[e.orientation]}` : "";
  return `${count} ${SIZE_WORDS[e.size]} ${FILL_WORDS[e.fill]} ${noun}${dir}`;
}

export function describeLines(elements: readonly number[]): string {
  if (elements.length === 0) return "no lines";
  const names = elements.map((id) => LINE_ELEMENTS[id].name);
  if (names.length === 1) return `the ${names[0]}`;
  return `the ${names.slice(0, -1).join(", the ")} and the ${names[names.length - 1]}`;
}

export function describeFigure(fig: FigureSpec): string {
  const parts: string[] = [];
  for (const layer of fig.layers) {
    if (layer.kind === "entity") parts.push(describeEntity(layer));
    else if (layer.kind === "lines") parts.push(describeLines(layer.elements));
    else parts.push(`a ${layer.shape} marker at the ${POSITION_NAMES[layer.position]}`);
  }
  return parts.join(", with ");
}

export function sortedSet(xs: Iterable<number>): number[] {
  return [...new Set(xs)].sort((a, b) => a - b);
}

export const setOps = {
  or: (a: readonly number[], b: readonly number[]) => sortedSet([...a, ...b]),
  and: (a: readonly number[], b: readonly number[]) => sortedSet(a.filter((x) => b.includes(x))),
  xor: (a: readonly number[], b: readonly number[]) =>
    sortedSet([...a.filter((x) => !b.includes(x)), ...b.filter((x) => !a.includes(x))]),
  minus: (a: readonly number[], b: readonly number[]) => sortedSet(a.filter((x) => !b.includes(x))),
};

export function sameSet(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
