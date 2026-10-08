/**
 * Mental rotation generators (Gv, visualization / spatial relations).
 *
 * 2D: a chiral polyomino with no rotational symmetry is shown upright. One
 * option is the same shape rotated; the foils are its mirror image at other
 * angles (which cannot be made to match by rotation alone) and, at the easier
 * levels, a structurally different shape (one cell moved).
 *
 * 3D: Shepard & Metzler (1971)-style objects built from cubes in four arms,
 * drawn in isometric projection. One option is the object in a different
 * orientation; the foils are its mirror image in other orientations. Every
 * view is checked so that no cube is substantially hidden.
 *
 * Correctness is established with canonical forms under the rotation group
 * (C4 in 2D, the 24-element cube rotation group in 3D): an option is "the
 * same object" iff its canonical form equals the target's.
 */

import type { Rng } from "../../random";
import { estimateTime, makeDifficulty } from "../difficulty";
import {
  canonical3,
  canonicalC4,
  canonicalD4,
  CUBE_ROTATIONS,
  cubeVisibility,
  hasRotationalSymmetry2,
  isChiral2,
  isChiral3,
  isConnected2,
  matMul,
  mirror2,
  mirror3,
  normalize2,
  normalize3,
  rotate2,
  rotate3,
  rotationAngle,
  rotationalSymmetryCount3,
  transpose,
  viewSignature,
  type Mat3,
} from "../geometry";
import type { Cell2, Item, OptionContent, Voxel } from "../types";
import { choiceResponse, retry } from "./common";

export const ROTATION_GENERATOR = { name: "rotation", version: "1.0.0" };

// ---------------------------------------------------------------------------
// 2D
// ---------------------------------------------------------------------------

export interface Rotation2DRecipe {
  cells: number;
  /** Rotation of the correct option in degrees (multiple of 45). */
  angle: 90 | 180 | 270 | 45 | 135 | 225 | 315;
  /**
   * The second foil shape differs from the target by one moved cell (subtle)
   * or is an unrelated shape with the same number of cells.
   */
  subtle: boolean;
}

function randomPolyomino(n: number, rng: Rng, maxSpan: number): Cell2[] | null {
  const cells: Cell2[] = [[0, 0]];
  const has = (x: number, y: number) => cells.some((c) => c[0] === x && c[1] === y);
  for (let guard = 0; cells.length < n && guard < 500; guard++) {
    const [x, y] = rng.pick(cells);
    const [dx, dy] = rng.pick([
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]);
    if (!has(x + dx, y + dy)) cells.push([x + dx, y + dy]);
    const xs = cells.map((c) => c[0]);
    const ys = cells.map((c) => c[1]);
    if (Math.max(...xs) - Math.min(...xs) >= maxSpan || Math.max(...ys) - Math.min(...ys) >= maxSpan) cells.pop();
  }
  return cells.length === n ? normalize2(cells) : null;
}

function movedCellVariant(cells: Cell2[], rng: Rng): Cell2[] | null {
  for (let attempt = 0; attempt < 100; attempt++) {
    const removeIdx = rng.int(0, cells.length - 1);
    const rest = cells.filter((_, i) => i !== removeIdx);
    const [x, y] = rng.pick(rest);
    const [dx, dy] = rng.pick([
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]);
    const cand: Cell2 = [x + dx, y + dy];
    if (cells.some((c) => c[0] === cand[0] && c[1] === cand[1])) continue;
    const out = normalize2([...rest, cand]);
    if (!isConnected2(out)) continue;
    return out;
  }
  return null;
}

/**
 * Options form two mirror pairs: {target, mirror(target)} and
 * {other, mirror(other)}. No option is the "odd one out" among the options,
 * so the answer cannot be found without comparing against the target.
 */
export function generateRotation2DItem(recipe: Rotation2DRecipe, id: string, seed: number, rngFactory: (s: number) => Rng): Item {
  const rng = rngFactory(seed);
  const built = retry(`rotation2d ${id}`, 4000, () => {
    const span = recipe.cells <= 6 ? 3 : 4;
    const target = randomPolyomino(recipe.cells, rng, span);
    if (!target || !isChiral2(target) || hasRotationalSymmetry2(target)) return null;
    const other = recipe.subtle ? movedCellVariant(target, rng) : randomPolyomino(recipe.cells, rng, span);
    if (!other || !isChiral2(other) || hasRotationalSymmetry2(other)) return null;
    if (canonicalD4(other) === canonicalD4(target)) return null;
    const quarter = Math.floor(recipe.angle / 90);
    const extra = recipe.angle % 90;
    const q = rng.shuffle([0, 1, 2, 3].filter((x) => x !== quarter));
    const correct = { cells: rotate2(target, quarter), rotationDeg: extra, kind: "same" };
    const foils = [
      { cells: rotate2(mirror2(target), q[0]), rotationDeg: extra, kind: "mirror" },
      { cells: rotate2(other, rng.int(0, 3)), rotationDeg: extra, kind: recipe.subtle ? "moved-cell" : "different" },
      { cells: rotate2(mirror2(other), q[1]), rotationDeg: extra, kind: recipe.subtle ? "moved-cell-mirror" : "different-mirror" },
    ];
    const all = [correct, ...foils];
    const keys = new Set(all.map((o) => `${o.cells.map((c) => c.join(",")).join(";")}@${o.rotationDeg}`));
    if (keys.size !== all.length) return null;
    const same = all.filter((o) => canonicalC4(o.cells) === canonicalC4(target));
    if (same.length !== 1 || same[0] !== correct) return null;
    return { target, correct, foils };
  });

  const toOption = (o: { cells: Cell2[]; rotationDeg: number }): OptionContent => ({
    type: "polyomino",
    cells: o.cells,
    rotationDeg: o.rotationDeg,
  });
  const response = choiceResponse(rng, toOption(built.correct), built.foils.map(toOption));
  const disparity = Math.min(recipe.angle, 360 - recipe.angle);
  const logit =
    -2.0 +
    0.3 * (recipe.cells - 5) +
    (disparity === 180 ? 0.3 : disparity % 90 !== 0 ? 0.6 : 0) +
    (recipe.subtle ? 0.5 : 0);
  const difficulty = makeDifficulty("rotation2d-complexity@2", logit, {
    cells: recipe.cells,
    angularDisparity: disparity,
    subtleFoil: recipe.subtle,
  });
  return {
    id,
    version: 1,
    domain: "Gv",
    narrowAbility: "Vz",
    family: "rotation-2d",
    practice: false,
    prompt: "Which option is the same shape as the one on the left, only rotated? (Flipped shapes do not count.)",
    stimulus: { type: "rotation-2d", target: built.target },
    response,
    explanation: `The correct option is the shape turned ${recipe.angle}° clockwise. One other option is its mirror image, which no rotation can turn back into the original; the remaining two are a ${
      recipe.subtle ? "slightly different shape (one square moved)" : "different shape"
    } and its mirror image.`,
    rules: [`rotate:${recipe.angle}`, `foils:${built.foils.map((f) => f.kind).join(",")}`],
    difficulty,
    estimatedTimeSec: estimateTime(20, difficulty.level),
    timeLimitSec: 60,
    provenance: { generator: ROTATION_GENERATOR.name, generatorVersion: ROTATION_GENERATOR.version, seed },
    verification: { kind: "rotation-2d" },
  };
}

export const ROTATION2D_PLAN: Rotation2DRecipe[] = [
  { cells: 5, angle: 90, subtle: false },
  { cells: 5, angle: 270, subtle: false },
  { cells: 5, angle: 180, subtle: false },
  { cells: 6, angle: 90, subtle: false },
  { cells: 6, angle: 180, subtle: true },
  { cells: 6, angle: 270, subtle: true },
  { cells: 6, angle: 45, subtle: false },
  { cells: 7, angle: 90, subtle: true },
  { cells: 7, angle: 180, subtle: false },
  { cells: 7, angle: 135, subtle: true },
  { cells: 7, angle: 315, subtle: false },
  { cells: 8, angle: 270, subtle: true },
  { cells: 8, angle: 135, subtle: true },
  { cells: 8, angle: 225, subtle: false },
  { cells: 8, angle: 180, subtle: true },
  { cells: 9, angle: 45, subtle: true },
  { cells: 9, angle: 135, subtle: true },
  { cells: 9, angle: 225, subtle: true },
];

// ---------------------------------------------------------------------------
// 3D
// ---------------------------------------------------------------------------

export interface Rotation3DRecipe {
  cubes: number;
  /** Desired angle between target and correct view. */
  angle: 90 | 120 | 180;
}

const AXES: Voxel[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** A Shepard–Metzler-like object: four straight arms joined at right angles. */
function randomArmObject(nCubes: number, rng: Rng): Voxel[] | null {
  const lengths = [0, 0, 0, 0];
  let remaining = nCubes - 1;
  for (let i = 0; i < 4; i++) lengths[i] = 1;
  remaining -= 4;
  while (remaining > 0) {
    const i = rng.int(0, 3);
    if (lengths[i] < 4) {
      lengths[i]++;
      remaining--;
    }
  }
  const voxels: Voxel[] = [[0, 0, 0]];
  let dir = rng.pick(AXES);
  for (let arm = 0; arm < 4; arm++) {
    if (arm > 0) {
      const perp = AXES.filter((a) => a[0] * dir[0] + a[1] * dir[1] + a[2] * dir[2] === 0);
      dir = rng.pick(perp);
    }
    for (let s = 0; s < lengths[arm]; s++) {
      const last = voxels[voxels.length - 1];
      const next: Voxel = [last[0] + dir[0], last[1] + dir[1], last[2] + dir[2]];
      if (voxels.some((v) => v[0] === next[0] && v[1] === next[1] && v[2] === next[2])) return null;
      voxels.push(next);
    }
  }
  // Must use all three dimensions.
  const spans = [0, 1, 2].map((i) => new Set(voxels.map((v) => v[i])).size);
  if (spans.some((s) => s < 2)) return null;
  return normalize3(voxels);
}

function wellVisible(voxels: Voxel[]): boolean {
  return cubeVisibility(voxels).every((f) => f >= 0.25);
}

export function generateRotation3DItem(recipe: Rotation3DRecipe, id: string, seed: number, rngFactory: (s: number) => Rng): Item {
  const rng = rngFactory(seed);
  const built = retry(`rotation3d ${id}`, 4000, () => {
    const base = randomArmObject(recipe.cubes, rng);
    if (!base || !isChiral3(base) || rotationalSymmetryCount3(base) !== 1) return null;
    const visibleRotations = CUBE_ROTATIONS.filter((m) => wellVisible(rotate3(base, m)));
    if (visibleRotations.length < 6) return null;
    const rT = rng.pick(visibleRotations);
    const target = rotate3(base, rT);
    const candidates = visibleRotations.filter((m) => rotationAngle(matMul(m, transpose(rT))) === recipe.angle);
    if (candidates.length === 0) return null;
    const rC = rng.pick(candidates);
    const correct = rotate3(base, rC);
    // Foils form mirror pairs, as in 2D: mirror(base), other, mirror(other).
    const other = randomArmObject(recipe.cubes, rng);
    if (!other || !isChiral3(other) || rotationalSymmetryCount3(other) !== 1) return null;
    const canon = new Set([canonical3(base), canonical3(mirror3(base))]);
    if (canon.has(canonical3(other)) || canon.has(canonical3(mirror3(other)))) return null;
    const sigs = new Set([viewSignature(target), viewSignature(correct)]);
    if (sigs.size !== 2) return null;
    const foils: Voxel[][] = [];
    for (const shape of [mirror3(base), other, mirror3(other)]) {
      const view = rng
        .shuffle(CUBE_ROTATIONS)
        .map((m) => rotate3(shape, m))
        .find((v) => wellVisible(v) && !sigs.has(viewSignature(v)));
      if (!view) return null;
      sigs.add(viewSignature(view));
      foils.push(view);
    }
    const same = [correct, ...foils].filter((o) => canonical3(o) === canonical3(target));
    if (same.length !== 1) return null;
    return { target, correct, foils };
  });

  const toOption = (voxels: Voxel[]): OptionContent => ({ type: "polycube", voxels });
  const response = choiceResponse(rng, toOption(built.correct), built.foils.map(toOption));
  const logit =
    0.4 +
    0.25 * (recipe.cubes - 8) +
    (recipe.cubes >= 10 ? 0.3 : 0) +
    (recipe.angle >= 120 ? 0.2 : 0) +
    (recipe.angle === 180 ? 0.3 : 0);
  const difficulty = makeDifficulty("rotation3d-complexity@2", logit, {
    cubes: recipe.cubes,
    angle: recipe.angle,
  });
  return {
    id,
    version: 1,
    domain: "Gv",
    narrowAbility: "Vz",
    family: "rotation-3d",
    practice: false,
    prompt: "Which option shows the same object as the one on the left, seen from a different angle?",
    stimulus: { type: "rotation-3d", target: built.target },
    response,
    explanation: `The correct option is the same arrangement of cubes turned ${recipe.angle}° in space. One other option is its mirror image, which no rotation can turn into the original; the remaining two are a differently built object and its mirror image.`,
    rules: [`rotate3d:${recipe.angle}`, "foils:mirror,different,different-mirror"],
    difficulty,
    estimatedTimeSec: estimateTime(35, difficulty.level),
    timeLimitSec: 90,
    provenance: { generator: ROTATION_GENERATOR.name, generatorVersion: ROTATION_GENERATOR.version, seed },
    verification: { kind: "rotation-3d" },
  };
}

export const ROTATION3D_PLAN: Rotation3DRecipe[] = [
  { cubes: 8, angle: 90 },
  { cubes: 8, angle: 120 },
  { cubes: 8, angle: 180 },
  { cubes: 9, angle: 90 },
  { cubes: 9, angle: 120 },
  { cubes: 9, angle: 180 },
  { cubes: 10, angle: 90 },
  { cubes: 10, angle: 120 },
  { cubes: 10, angle: 180 },
  { cubes: 10, angle: 180 },
  { cubes: 11, angle: 120 },
  { cubes: 11, angle: 180 },
  { cubes: 11, angle: 90 },
  { cubes: 12, angle: 180 },
  { cubes: 12, angle: 120 },
  { cubes: 12, angle: 180 },
];
