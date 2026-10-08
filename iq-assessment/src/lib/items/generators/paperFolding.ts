/**
 * Paper folding generator (Gv, visualization). Inspired by the paper-folding
 * paradigm in the ETS Kit of Factor-Referenced Cognitive Tests (Ekstrom et
 * al., 1976); all items here are newly generated.
 *
 * A square sheet is folded one to three times, holes are punched through the
 * folded paper, and the participant chooses how the sheet looks unfolded.
 * The key is computed by exact reflection geometry (`paper.ts`); foils model
 * typical errors: forgetting to unfold one fold, reflecting across the wrong
 * line, shifting or dropping a hole.
 */

import type { Rng } from "../../random";
import { estimateTime, makeDifficulty } from "../difficulty";
import { applyFold, canFold, foldSequence, samePattern, sortPts, strictlyInside, toUnit, unfold, type Pt } from "../paper";
import type { FoldKind, Item, OptionContent } from "../types";
import { choiceResponse, retry } from "./common";

export const PAPER_GENERATOR = { name: "paper-folding", version: "1.0.0" };

export interface PaperRecipe {
  folds: 1 | 2 | 3;
  /** Use a diagonal fold (as the last fold). */
  diagonal: boolean;
  /** Two folds along the same axis (a strip) instead of perpendicular ones. */
  sameAxis?: boolean;
  punches: 1 | 2;
}

const VERTICAL: FoldKind[] = ["left-over-right", "right-over-left"];
const HORIZONTAL: FoldKind[] = ["top-over-bottom", "bottom-over-top"];
const DIAGONAL: FoldKind[] = ["diag-main", "diag-anti"];

function chooseFolds(recipe: PaperRecipe, rng: Rng): FoldKind[] {
  if (recipe.folds === 1) return [recipe.diagonal ? rng.pick(DIAGONAL) : rng.pick([...VERTICAL, ...HORIZONTAL])];
  const firstAxis = rng.bool() ? VERTICAL : HORIZONTAL;
  const secondAxis = recipe.sameAxis ? firstAxis : firstAxis === VERTICAL ? HORIZONTAL : VERTICAL;
  const folds = [rng.pick(firstAxis), rng.pick(secondAxis)];
  if (recipe.folds === 3) folds.push(rng.pick(DIAGONAL));
  return folds;
}

const GRID = [1, 3, 5, 7, 9, 11, 13, 15];

/** Number of the sheet's four mirror symmetries a hole pattern has. */
export function symmetryCount(holes: Pt[]): number {
  const maps = [
    ([x, y]: Pt): Pt => [16 - x, y],
    ([x, y]: Pt): Pt => [x, 16 - y],
    ([x, y]: Pt): Pt => [y, x],
    ([x, y]: Pt): Pt => [16 - y, 16 - x],
  ];
  return maps.filter((m) => samePattern(holes.map(m), holes)).length;
}

function wrongAxis(kind: FoldKind): FoldKind[] {
  if (VERTICAL.includes(kind)) return HORIZONTAL;
  if (HORIZONTAL.includes(kind)) return VERTICAL;
  return DIAGONAL.filter((d) => d !== kind);
}

export function generatePaperItem(recipe: PaperRecipe, id: string, seed: number, rngFactory: (s: number) => Rng): Item {
  const rng = rngFactory(seed);
  const built = retry(`paper ${id}`, 1000, () => {
    const folds = chooseFolds(recipe, rng);
    const steps = foldSequence(folds);
    const final = steps[steps.length - 1].after;
    const inside = GRID.flatMap((x) => GRID.map((y) => [x, y] as Pt)).filter((p) => strictlyInside(final, p));
    if (inside.length < recipe.punches) return null;
    const punches = sortPts(rng.sample(inside, recipe.punches));
    const key = unfold(folds, punches);

    // Candidate foils modelling typical errors.
    const foils: Pt[][] = [];
    for (let i = 0; i < folds.length; i++) foils.push(unfold(folds, punches, new Set([i])));
    for (let i = 0; i < folds.length; i++) {
      for (const alt of wrongAxis(folds[i])) {
        // Reflect across a different line at the same step (if that fold is possible there).
        const before = steps[i].before;
        if (!canFold(before, alt)) continue;
        const wrongStep = applyFold(before, alt);
        let holes = sortPts(punches);
        for (let j = steps.length - 1; j >= 0; j--) {
          const reflect = j === i ? wrongStep.reflect : steps[j].reflect;
          holes = sortPts([...holes, ...holes.map(reflect)]);
        }
        foils.push(holes);
      }
    }
    const inSheet = (p: Pt) => p[0] > 0 && p[0] < 16 && p[1] > 0 && p[1] < 16;
    for (let attempt = 0; attempt < 6; attempt++) {
      const idx = rng.int(0, key.length - 1);
      const [dx, dy] = rng.pick([
        [2, 0],
        [-2, 0],
        [0, 2],
        [0, -2],
      ]);
      const moved: Pt = [key[idx][0] + dx, key[idx][1] + dy];
      if (!inSheet(moved)) continue;
      foils.push(sortPts([...key.filter((_, j) => j !== idx), moved]));
    }
    // Punching one grid step away gives a pattern with exactly the key's
    // symmetry, which defeats a "pick the most symmetric option" strategy.
    for (const [dx, dy] of rng.shuffle([
      [2, 0],
      [-2, 0],
      [0, 2],
      [0, -2],
    ])) {
      const moved = punches.map(([x, y]) => [x + dx, y + dy] as Pt);
      if (moved.every((p) => strictlyInside(final, p))) foils.push(unfold(folds, moved));
    }
    if (key.length > 1) foils.push(key.filter((_, j) => j !== rng.int(0, key.length - 1)));
    foils.push(sortPts(key.map(([x, y]) => [16 - x, y] as Pt)));
    foils.push(sortPts(key.map(([x, y]) => [x, 16 - y] as Pt)));

    // Keep distinct foils that differ from the key; prefer ones with the same hole count.
    const distinct: Pt[][] = [];
    for (const f of foils) {
      if (f.length === 0 || new Set(f.map((p) => p.join(","))).size !== f.length) continue;
      if (samePattern(f, key) || distinct.some((d) => samePattern(d, f))) continue;
      distinct.push(f);
    }
    // Prefer foils at least as symmetric as the key, then those with the same
    // number of holes.
    const keySym = symmetryCount(key);
    const rank = (f: Pt[]) => (symmetryCount(f) >= keySym ? 2 : 0) + (f.length === key.length ? 1 : 0);
    const chosen = rng
      .shuffle(distinct)
      .map((f) => ({ f, r: rank(f) }))
      .sort((a, b) => b.r - a.r)
      .slice(0, 4)
      .map((x) => x.f);
    if (chosen.length < 4) return null;
    return { folds, punches, key, foils: chosen };
  });

  const toOption = (holes: Pt[]): OptionContent => ({ type: "holes", holes: holes.map(toUnit) });
  const response = choiceResponse(rng, toOption(built.key), built.foils.map(toOption));
  const logit =
    -2.0 +
    0.9 * (recipe.folds - 1) +
    (recipe.diagonal ? 0.6 : 0) +
    0.35 * (recipe.punches - 1) +
    (recipe.sameAxis ? 0.3 : 0);
  const difficulty = makeDifficulty("paper-complexity@1", logit, {
    folds: recipe.folds,
    diagonal: recipe.diagonal,
    punches: recipe.punches,
    sameAxis: !!recipe.sameAxis,
  });
  const n = built.key.length;
  return {
    id,
    version: 1,
    domain: "Gv",
    narrowAbility: "Vz",
    family: "paper-folding",
    practice: false,
    prompt: "The square sheet is folded as shown, then holes are punched through all layers. Which option shows the sheet unfolded?",
    stimulus: { type: "paper-folding", folds: built.folds, punches: built.punches.map(toUnit) },
    response,
    explanation: `Each fold doubles the number of layers the punch goes through. Unfolding reverses the folds one at a time, last fold first, and every hole is mirrored across the fold line it passes through. That gives ${n} hole${n === 1 ? "" : "s"} in the positions shown in the correct option.`,
    rules: [`folds:${built.folds.join(",")}`, `punches:${recipe.punches}`],
    difficulty,
    estimatedTimeSec: estimateTime(35, difficulty.level),
    timeLimitSec: 120,
    provenance: { generator: PAPER_GENERATOR.name, generatorVersion: PAPER_GENERATOR.version, seed },
    verification: { kind: "paper-folding" },
  };
}

export const PAPER_PLAN: PaperRecipe[] = [
  { folds: 1, diagonal: false, punches: 1 },
  { folds: 1, diagonal: false, punches: 1 },
  { folds: 1, diagonal: false, punches: 2 },
  { folds: 1, diagonal: true, punches: 1 },
  { folds: 1, diagonal: true, punches: 2 },
  { folds: 2, diagonal: false, punches: 1 },
  { folds: 2, diagonal: false, punches: 1, sameAxis: true },
  { folds: 2, diagonal: false, punches: 2 },
  { folds: 2, diagonal: false, punches: 2, sameAxis: true },
  { folds: 3, diagonal: true, punches: 1 },
  { folds: 3, diagonal: true, punches: 2 },
  { folds: 3, diagonal: true, punches: 1 },
  { folds: 3, diagonal: true, punches: 2 },
  { folds: 2, diagonal: false, punches: 2 },
];

