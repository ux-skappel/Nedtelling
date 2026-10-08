/**
 * Assembles the complete item bank from the generators and the hand-written
 * verbal content. Deterministic: the same code always yields the same bank,
 * which `scripts/generate-item-bank.ts` freezes to `src/data/item-bank.json`.
 *
 * Ids are assigned after shuffling each family, so an id's number carries no
 * information about the item's difficulty.
 */

import { Rng, seedFromString } from "../../random";
import { ANALOGIES, buildVerbalItem, CLASSIFICATION, VERBAL_PRACTICE, VOCABULARY } from "../content/verbal";
import type { Item, ItemBank } from "../types";
import { pad } from "./common";
import { DEDUCTION_PLAN, generateDeductionItem } from "./deduction";
import { generateSeriesItem, SERIES_PLAN } from "./figureSeries";
import { generateMatrixItem, MATRIX_PLAN } from "./matrices";
import { generateSpanPractice, generateSpanTrials, type SpanTask } from "./memory";
import { generatePaperItem, PAPER_PLAN } from "./paperFolding";
import {
  BALANCE_PLAN,
  generateBalanceItem,
  generateNumberMatrixItem,
  generateNumberSeriesItem,
  NUMBER_MATRIX_PLAN,
  NUMBER_SERIES_PLAN,
} from "./quantitative";
import { generateRotation2DItem, generateRotation3DItem, ROTATION2D_PLAN, ROTATION3D_PLAN } from "./rotation";
import { generateComparisonTrials, generateSymbolSearchTrials } from "./speed";

export const BANK_VERSION = "1.0.0";

const rngFactory = (s: number) => new Rng(s);

function family<R>(
  prefix: string,
  plan: R[],
  make: (recipe: R, id: string, seed: number) => Item,
): Item[] {
  const base = seedFromString(prefix);
  const items = plan.map((recipe, i) => make(recipe, `${prefix}-tmp-${i}`, (base + i * 7919) >>> 0));
  const order = new Rng(base ^ 0x5bd1e995).shuffle(items.map((_, i) => i));
  return order.map((src, n) => ({ ...items[src], id: `${prefix}-${pad(n + 1)}` }));
}

function verbal(prefix: string, fam: "vocabulary" | "analogy" | "classification", specs: Parameters<typeof buildVerbalItem>[1][]): Item[] {
  const rng = new Rng(seedFromString(prefix));
  const items = specs.map((spec, i) => buildVerbalItem(fam, spec, `${prefix}-tmp-${i}`, rng));
  const order = rng.shuffle(items.map((_, i) => i));
  return order.map((src, n) => ({ ...items[src], id: `${prefix}-${pad(n + 1)}` }));
}

function practiceItems(): Item[] {
  const p = (item: Item, id: string): Item => ({ ...item, id, practice: true });
  const out: Item[] = [
    p(generateMatrixItem({ template: "entity", variant: "shapes", entityRules: { count: "prog" } }, "x", 11, rngFactory), "PR-GF-MX-001"),
    p(generateSeriesItem({ rules: { orientation: "cyc1" } }, "x", 12, rngFactory), "PR-GF-FS-001"),
    p(
      generateDeductionItem({ format: "order", n: 3, question: "top", scrambled: false, mixed: false, negation: false }, "x", 13, rngFactory),
      "PR-GF-DE-001",
    ),
    p(generateRotation2DItem({ cells: 5, angle: 90, subtle: false }, "x", 14, rngFactory), "PR-GV-R2-001"),
    p(generatePaperItem({ folds: 1, diagonal: false, punches: 1 }, "x", 15, rngFactory), "PR-GV-PF-001"),
    p(generateRotation3DItem({ cubes: 8, angle: 90 }, "x", 16, rngFactory), "PR-GV-R3-001"),
    p(generateNumberSeriesItem("arith-small", "x", 17, rngFactory), "PR-GQ-NS-001"),
    p(generateBalanceItem("direct", "x", 18, rngFactory), "PR-GQ-BA-001"),
    p(generateNumberMatrixItem("sum", "x", 19, rngFactory), "PR-GQ-NM-001"),
  ];
  const rng = new Rng(20);
  VERBAL_PRACTICE.forEach(({ family: fam, spec }, i) => {
    out.push(buildVerbalItem(fam as "vocabulary" | "analogy" | "classification", spec, `PR-GC-${["VO", "AN", "CL"][i]}-001`, rng, true));
  });
  const tasks: SpanTask[] = ["digit-span-forward", "digit-span-backward", "sequence-reordering", "spatial-span"];
  tasks.forEach((t, i) => out.push(generateSpanPractice(t, 30 + i, rngFactory)));
  out.push(...generateSymbolSearchTrials(4, 40, rngFactory, true));
  out.push(...generateComparisonTrials(4, 41, rngFactory, true));
  return out;
}

export function generateItemBank(): ItemBank {
  const items: Item[] = [
    ...family("GF-MX", MATRIX_PLAN, (r, id, s) => generateMatrixItem(r, id, s, rngFactory)),
    ...family("GF-FS", SERIES_PLAN, (r, id, s) => generateSeriesItem(r, id, s, rngFactory)),
    ...family("GF-DE", DEDUCTION_PLAN, (r, id, s) => generateDeductionItem(r, id, s, rngFactory)),
    ...family("GV-R2", ROTATION2D_PLAN, (r, id, s) => generateRotation2DItem(r, id, s, rngFactory)),
    ...family("GV-R3", ROTATION3D_PLAN, (r, id, s) => generateRotation3DItem(r, id, s, rngFactory)),
    ...family("GV-PF", PAPER_PLAN, (r, id, s) => generatePaperItem(r, id, s, rngFactory)),
    ...family("GQ-NS", NUMBER_SERIES_PLAN, (r, id, s) => generateNumberSeriesItem(r, id, s, rngFactory)),
    ...family("GQ-BA", BALANCE_PLAN, (r, id, s) => generateBalanceItem(r, id, s, rngFactory)),
    ...family("GQ-NM", NUMBER_MATRIX_PLAN, (r, id, s) => generateNumberMatrixItem(r, id, s, rngFactory)),
    ...verbal("GC-VO", "vocabulary", VOCABULARY),
    ...verbal("GC-AN", "analogy", ANALOGIES),
    ...verbal("GC-CL", "classification", CLASSIFICATION),
    ...generateSpanTrials("digit-span-forward", 101, rngFactory),
    ...generateSpanTrials("digit-span-backward", 102, rngFactory),
    ...generateSpanTrials("sequence-reordering", 103, rngFactory),
    ...generateSpanTrials("spatial-span", 104, rngFactory),
    ...generateSymbolSearchTrials(96, 201, rngFactory),
    ...generateComparisonTrials(96, 202, rngFactory),
    ...practiceItems(),
  ];
  return {
    bankVersion: BANK_VERSION,
    description:
      "Original item bank, version 1. All difficulties are a priori (complexity-model or expert-rated) and uncalibrated. No item has been administered to a norm sample.",
    items,
  };
}
