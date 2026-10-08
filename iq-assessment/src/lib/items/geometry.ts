/**
 * Geometry shared by the spatial item generators, their verifiers and the
 * SVG renderers (so what is verified is exactly what is drawn).
 */

import type { Cell2, Voxel } from "./types";

// ---------------------------------------------------------------------------
// 2D polyominoes
// ---------------------------------------------------------------------------

export function normalize2(cells: readonly Cell2[]): Cell2[] {
  const minX = Math.min(...cells.map((c) => c[0]));
  const minY = Math.min(...cells.map((c) => c[1]));
  return cells
    .map(([x, y]) => [x - minX, y - minY] as Cell2)
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/** Rotate 90° clockwise on screen (y grows downwards). */
export function rotate90(cells: readonly Cell2[]): Cell2[] {
  return normalize2(cells.map(([x, y]) => [-y, x] as Cell2));
}

export function rotate2(cells: readonly Cell2[], quarterTurns: number): Cell2[] {
  let out = normalize2(cells);
  for (let i = 0; i < ((quarterTurns % 4) + 4) % 4; i++) out = rotate90(out);
  return out;
}

export function mirror2(cells: readonly Cell2[]): Cell2[] {
  return normalize2(cells.map(([x, y]) => [-x, y] as Cell2));
}

const key2 = (cells: readonly Cell2[]) => normalize2(cells).map((c) => c.join(",")).join(";");

/** Canonical form under rotations only (C4). */
export function canonicalC4(cells: readonly Cell2[]): string {
  return [0, 1, 2, 3].map((k) => key2(rotate2(cells, k))).sort()[0];
}

/** Canonical form under rotations and reflections (D4). */
export function canonicalD4(cells: readonly Cell2[]): string {
  return [canonicalC4(cells), canonicalC4(mirror2(cells))].sort()[0];
}

export function isChiral2(cells: readonly Cell2[]): boolean {
  return canonicalC4(cells) !== canonicalC4(mirror2(cells));
}

export function hasRotationalSymmetry2(cells: readonly Cell2[]): boolean {
  const k0 = key2(cells);
  return [1, 2, 3].some((k) => key2(rotate2(cells, k)) === k0);
}

export function isConnected2(cells: readonly Cell2[]): boolean {
  if (cells.length === 0) return false;
  const set = new Set(cells.map((c) => c.join(",")));
  const seen = new Set<string>([cells[0].join(",")]);
  const stack = [cells[0]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const k = `${x + dx},${y + dy}`;
      if (set.has(k) && !seen.has(k)) {
        seen.add(k);
        stack.push([x + dx, y + dy]);
      }
    }
  }
  return seen.size === cells.length;
}

// ---------------------------------------------------------------------------
// 3D polycubes
// ---------------------------------------------------------------------------

export type Mat3 = [number, number, number, number, number, number, number, number, number];

function det3(m: Mat3): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

/** The 24 proper rotations of the cube (signed permutation matrices, det = +1). */
export const CUBE_ROTATIONS: Mat3[] = (() => {
  const perms = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];
  const out: Mat3[] = [];
  for (const p of perms)
    for (let signs = 0; signs < 8; signs++) {
      const m = Array(9).fill(0) as Mat3;
      for (let r = 0; r < 3; r++) m[r * 3 + p[r]] = (signs >> r) & 1 ? -1 : 1;
      if (det3(m) === 1) out.push(m);
    }
  return out;
})();

export function applyMat(m: Mat3, [x, y, z]: Voxel): Voxel {
  return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
}

export function normalize3(voxels: readonly Voxel[]): Voxel[] {
  const min = [0, 1, 2].map((i) => Math.min(...voxels.map((v) => v[i])));
  return voxels
    .map((v) => [v[0] - min[0], v[1] - min[1], v[2] - min[2]] as Voxel)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
}

export function rotate3(voxels: readonly Voxel[], m: Mat3): Voxel[] {
  return normalize3(voxels.map((v) => applyMat(m, v)));
}

export function mirror3(voxels: readonly Voxel[]): Voxel[] {
  return normalize3(voxels.map(([x, y, z]) => [-x, y, z] as Voxel));
}

const key3 = (voxels: readonly Voxel[]) => normalize3(voxels).map((v) => v.join(",")).join(";");

export function canonical3(voxels: readonly Voxel[]): string {
  return CUBE_ROTATIONS.map((m) => key3(rotate3(voxels, m))).sort()[0];
}

export function isChiral3(voxels: readonly Voxel[]): boolean {
  return canonical3(voxels) !== canonical3(mirror3(voxels));
}

export function rotationalSymmetryCount3(voxels: readonly Voxel[]): number {
  const k0 = key3(voxels);
  return CUBE_ROTATIONS.filter((m) => key3(rotate3(voxels, m)) === k0).length;
}

/** Rotation angle (degrees) of a rotation matrix. */
export function rotationAngle(m: Mat3): number {
  const trace = m[0] + m[4] + m[8];
  return Math.round((Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2))) * 180) / Math.PI);
}

export function matMul(a: Mat3, b: Mat3): Mat3 {
  const out = Array(9).fill(0) as Mat3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) out[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return out;
}

export function transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

// Isometric projection: camera looks along −(1, 1, 1). Visible faces are +x, +y, +z.
const COS30 = Math.cos(Math.PI / 6);

export function project([x, y, z]: [number, number, number]): [number, number] {
  return [(x - y) * COS30, (x + y) * 0.5 - z];
}

export interface IsoFace {
  points: [number, number][];
  shade: "top" | "right" | "left";
  depth: number;
  voxel: number;
}

/** Visible faces in painter's order (far to near). */
export function isometricFaces(voxels: readonly Voxel[]): IsoFace[] {
  const set = new Set(voxels.map((v) => v.join(",")));
  const has = (x: number, y: number, z: number) => set.has(`${x},${y},${z}`);
  const faces: IsoFace[] = [];
  voxels.forEach(([x, y, z], i) => {
    const depth = x + y + z;
    if (!has(x, y, z + 1))
      faces.push({
        shade: "top",
        depth,
        voxel: i,
        points: [
          [x, y, z + 1],
          [x + 1, y, z + 1],
          [x + 1, y + 1, z + 1],
          [x, y + 1, z + 1],
        ].map((p) => project(p as [number, number, number])),
      });
    if (!has(x + 1, y, z))
      faces.push({
        shade: "right",
        depth,
        voxel: i,
        points: [
          [x + 1, y, z],
          [x + 1, y + 1, z],
          [x + 1, y + 1, z + 1],
          [x + 1, y, z + 1],
        ].map((p) => project(p as [number, number, number])),
      });
    if (!has(x, y + 1, z))
      faces.push({
        shade: "left",
        depth,
        voxel: i,
        points: [
          [x, y + 1, z],
          [x + 1, y + 1, z],
          [x + 1, y + 1, z + 1],
          [x, y + 1, z + 1],
        ].map((p) => project(p as [number, number, number])),
      });
  });
  return faces.sort((a, b) => a.depth - b.depth);
}

/** Point-in-convex-polygon (vertices in order). */
function insideConvex(pt: [number, number], poly: [number, number][]): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const cross = (x2 - x1) * (pt[1] - y1) - (y2 - y1) * (pt[0] - x1);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * Fraction of each cube's visible-face area that is not hidden behind nearer
 * cubes, estimated by sampling. Used to reject views in which part of the
 * object is hidden (an occluded cube makes "same object?" undecidable).
 */
export function cubeVisibility(voxels: readonly Voxel[], samplesPerEdge = 6): number[] {
  const faces = isometricFaces(voxels);
  return voxels.map((_, i) => {
    const own = faces.filter((f) => f.voxel === i);
    const nearer = faces.filter((f) => f.depth > voxels[i][0] + voxels[i][1] + voxels[i][2]);
    let total = 0;
    let visible = 0;
    for (const f of own) {
      const [a, b, , d] = f.points;
      for (let s = 0; s < samplesPerEdge; s++)
        for (let t = 0; t < samplesPerEdge; t++) {
          const u = (s + 0.5) / samplesPerEdge;
          const w = (t + 0.5) / samplesPerEdge;
          const pt: [number, number] = [a[0] + u * (b[0] - a[0]) + w * (d[0] - a[0]), a[1] + u * (b[1] - a[1]) + w * (d[1] - a[1])];
          total++;
          if (!nearer.some((nf) => insideConvex(pt, nf.points))) visible++;
        }
    }
    return total === 0 ? 0 : visible / total;
  });
}

/** A rendering signature: two views with equal signatures look identical. */
export function viewSignature(voxels: readonly Voxel[]): string {
  return isometricFaces(normalize3(voxels))
    .map((f) => `${f.shade}:${f.points.map((p) => p.map((c) => c.toFixed(3)).join(",")).join(" ")}`)
    .sort()
    .join("|");
}
