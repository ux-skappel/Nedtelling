/**
 * Adaptive item selection.
 *
 *  - Information criterion: maximum Fisher information at the current
 *    ability estimate (Lord, 1980; Weiss, 1982). With the provisional
 *    parameters this amounts to choosing the item whose a priori difficulty is
 *    closest to (slightly above, because of the guessing floor) the current
 *    estimate: correct answers push the estimate up and therefore the next
 *    item up; incorrect answers do the opposite.
 *  - Content balancing: the constrained CAT procedure of Kingsbury & Zara
 *    (1989). The next item comes from the item family whose administered share
 *    lags its blueprint target the most, so a reasoning section mixes matrix,
 *    series and deduction items in fixed proportions instead of drifting to
 *    whichever family happens to be most informative.
 *  - Exposure control: "randomesque" selection (Kingsbury & Zara, 1989) picks
 *    at random among the k most informative eligible items. This costs a
 *    little information but stops every participant at the same estimate from
 *    seeing exactly the same item sequence.
 */

import type { Rng } from "../random";
import { information, type ItemParameters } from "./irt";

export interface Candidate {
  id: string;
  family: string;
  params: ItemParameters;
}

export interface SelectionContext {
  theta: number;
  /** Families of the items already administered in this section, in order. */
  administeredFamilies: readonly string[];
  /** Target share per family; families absent from the map get no quota. */
  contentTargets?: Readonly<Record<string, number>>;
  /** Size of the randomesque pool (1 = pure maximum information). */
  randomesqueK: number;
}

export interface Selection {
  item: Candidate;
  family: string;
  information: number;
  /** 0-based rank of the chosen item by information within its family. */
  rank: number;
  poolSize: number;
}

export function chooseFamily(
  available: ReadonlySet<string>,
  administeredFamilies: readonly string[],
  targets: Readonly<Record<string, number>> | undefined,
  rng: Rng,
): string | null {
  const families = [...available].sort();
  if (families.length === 0) return null;
  if (!targets) return null; // no balancing: caller picks across all families

  const n = administeredFamilies.length;
  const counts = new Map<string, number>();
  for (const f of administeredFamilies) counts.set(f, (counts.get(f) ?? 0) + 1);

  // Normalise targets over the families that still have items available.
  const eligible = families.filter((f) => (targets[f] ?? 0) > 0);
  if (eligible.length === 0) return rng.pick(families);
  const totalTarget = eligible.reduce((s, f) => s + targets[f], 0);

  let bestDeficit = -Infinity;
  let best: string[] = [];
  for (const f of eligible) {
    const target = targets[f] / totalTarget;
    const observed = n === 0 ? 0 : (counts.get(f) ?? 0) / n;
    const deficit = target - observed;
    if (deficit > bestDeficit + 1e-12) {
      bestDeficit = deficit;
      best = [f];
    } else if (Math.abs(deficit - bestDeficit) <= 1e-12) {
      best.push(f);
    }
  }
  return rng.pick(best);
}

export function selectItem(
  candidates: readonly Candidate[],
  ctx: SelectionContext,
  rng: Rng,
): Selection | null {
  if (candidates.length === 0) return null;
  const available = new Set(candidates.map((c) => c.family));
  const family = chooseFamily(available, ctx.administeredFamilies, ctx.contentTargets, rng);
  const pool = family ? candidates.filter((c) => c.family === family) : [...candidates];

  const ranked = pool
    .map((c) => ({ c, info: information(ctx.theta, c.params) }))
    // Sort by information, then by id so ties are deterministic.
    .sort((x, y) => y.info - x.info || (x.c.id < y.c.id ? -1 : 1));

  const k = Math.max(1, Math.min(ctx.randomesqueK, ranked.length));
  const rank = Math.floor(rng.next() * k);
  const chosen = ranked[rank];
  return {
    item: chosen.c,
    family: chosen.c.family,
    information: chosen.info,
    rank,
    poolSize: ranked.length,
  };
}
