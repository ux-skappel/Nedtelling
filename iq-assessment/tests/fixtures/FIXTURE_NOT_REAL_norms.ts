/**
 * TEST FIXTURES — NOT REAL DATA.
 *
 * These objects exist only to exercise the code path that would turn
 * calibrated ability estimates into norm-referenced scores once a genuine
 * norming study exists. The numbers are arbitrary. They must never be
 * imported by application code (a test enforces this).
 */

import type { CalibrationSet } from "@/lib/psychometrics/parameters";
import type { NormTable } from "@/lib/norms/types";
import type { Item } from "@/lib/items/types";
import { provisionalParameters } from "@/lib/psychometrics/parameters";
import { itemKey } from "@/lib/items/types";

export function FIXTURE_NOT_REAL_calibration(items: Item[]): CalibrationSet {
  return {
    id: "FIXTURE-NOT-REAL-CAL",
    status: "empirical",
    model: "3PL",
    bankVersion: "1.0.0",
    estimation: "FIXTURE — not an estimation",
    sampleSize: 1,
    population: "FIXTURE",
    collectedFrom: "1970-01-01",
    collectedTo: "1970-01-01",
    scaleDefinition: "FIXTURE",
    modelChecks: [],
    items: Object.fromEntries(
      items.map((i) => {
        const p = provisionalParameters(i);
        return [itemKey(i), { a: 1.2, b: p.b, c: p.c, n: 1 }];
      }),
    ),
  };
}

export const FIXTURE_NOT_REAL_norms: NormTable = {
  id: "FIXTURE-NOT-REAL-NORMS",
  status: "validated",
  title: "FIXTURE — NOT REAL",
  organisation: "FIXTURE",
  population: "FIXTURE",
  country: "FIXTURE",
  collectionPeriod: "FIXTURE",
  sampleSize: 1,
  calibrationSetId: "FIXTURE-NOT-REAL-CAL",
  bankVersion: "1.0.0",
  blueprintVersion: "1.0.0",
  modes: ["quick", "full"],
  ageBands: [
    {
      minAge: 16,
      maxAge: 90,
      n: 1,
      domains: { Gf: { mean: 0, sd: 1 }, Gv: { mean: 0, sd: 1 }, Gq: { mean: 0, sd: 1 }, Gwm: { mean: 0, sd: 1 }, Gc: { mean: 0, sd: 1 } },
      composite: { mean: 0, sd: 0.9 },
    },
  ],
  reliability: { Gf: 0.85, composite: 0.9 },
  composite: { domains: ["Gf", "Gv", "Gq", "Gwm", "Gc"], weights: [0.2, 0.2, 0.2, 0.2, 0.2], rationale: "FIXTURE", evidence: ["FIXTURE"] },
  supportedRange: [55, 145],
  evidence: { reliability: "FIXTURE", validity: ["FIXTURE"], differentialItemFunctioning: "FIXTURE" },
  intendedUse: "Unit tests only.",
};
