/**
 * Item bank validation.
 *
 * These tests establish that every item is *logically* sound: one defensible
 * key, distinct options, no shortcut that finds the key without solving the
 * item. They do NOT establish that items are psychometrically valid. That
 * requires administering them to real people (see docs/VALIDATION_ROADMAP.md).
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import bankJson from "@/data/item-bank.json";
import { stableStringify } from "./generators/common";
import { generateItemBank } from "./generators/index";
import { canonical3, canonicalC4, canonicalD4, cubeVisibility, mirror3, viewSignature } from "./geometry";
import { samePattern, unfold, fromUnit, type Pt } from "./paper";
import { solveBalance } from "./solvers/balanceSolver";
import { consistentOrders, determinedAt, entails, mustBeAbove, propEntails, not, type Categorical, type Formula, type OrderPremise } from "./solvers/logic";
import { extractAttributes, solveMatrix } from "./solvers/matrixSolver";
import { solveNumberMatrix } from "./solvers/numberMatrixSolver";
import { solveNumberSeries } from "./solvers/numberSeriesSolver";
import { solveSeries } from "./solvers/seriesSolver";
import { DOMAINS, ITEM_FAMILIES, scoreResponse, type FigureSpec, type Item, type ItemBank } from "./types";

const bank = bankJson as unknown as ItemBank;
const items = bank.items;
const scored = items.filter((i) => !i.practice);
const byFamily = (f: Item["family"]) => items.filter((i) => i.family === f);
const choice = (i: Item) => {
  if (i.response.kind !== "choice") throw new Error(`${i.id} is not a choice item`);
  return i.response;
};
const keyIndex = (i: Item) => choice(i).options.findIndex((o) => o.id === choice(i).correctOptionId);

const FAMILY_DOMAIN: Record<Item["family"], Item["domain"]> = {
  matrix: "Gf",
  "figure-series": "Gf",
  deduction: "Gf",
  "rotation-2d": "Gv",
  "rotation-3d": "Gv",
  "paper-folding": "Gv",
  "number-series": "Gq",
  balance: "Gq",
  "number-matrix": "Gq",
  "digit-span-forward": "Gwm",
  "digit-span-backward": "Gwm",
  "sequence-reordering": "Gwm",
  "spatial-span": "Gwm",
  "symbol-search": "Gs",
  "visual-comparison": "Gs",
  vocabulary: "Gc",
  analogy: "Gc",
  classification: "Gc",
};

describe("bank structure", () => {
  it("contains at least 200 scored adaptive items across the reasoning and knowledge domains", () => {
    const adaptive = scored.filter((i) => ["Gf", "Gv", "Gq", "Gc"].includes(i.domain));
    expect(adaptive.length).toBeGreaterThanOrEqual(200);
    for (const d of DOMAINS) expect(scored.filter((i) => i.domain === d).length).toBeGreaterThan(0);
  });

  it("has unique ids and every required field", () => {
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    for (const i of items) {
      expect(i.id, i.id).toMatch(/^[A-Z0-9-]+$/);
      expect(i.version).toBeGreaterThanOrEqual(1);
      expect(DOMAINS).toContain(i.domain);
      expect(ITEM_FAMILIES).toContain(i.family);
      expect(FAMILY_DOMAIN[i.family], i.id).toBe(i.domain);
      expect([1, 2, 3, 4, 5]).toContain(i.difficulty.level);
      expect(Number.isFinite(i.difficulty.logit)).toBe(true);
      expect(i.difficulty.method.length).toBeGreaterThan(0);
      expect(i.explanation.length, i.id).toBeGreaterThan(10);
      expect(i.prompt.length).toBeGreaterThan(5);
      expect(i.estimatedTimeSec).toBeGreaterThan(0);
      expect(i.provenance.generator.length).toBeGreaterThan(0);
      expect(i.contentHash, i.id).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("ids of adaptive items do not encode difficulty", () => {
    for (const fam of ["matrix", "figure-series", "number-series", "vocabulary"] as const) {
      const fi = byFamily(fam).filter((i) => !i.practice);
      const idx = fi.map((i) => Number(i.id.split("-").pop()));
      const logits = fi.map((i) => i.difficulty.logit);
      // Spearman-ish check: the id order should not track difficulty closely.
      const rank = (xs: number[]) => xs.map((x) => xs.filter((y) => y < x).length);
      const ri = rank(idx);
      const rl = rank(logits);
      const n = fi.length;
      const mean = (n - 1) / 2;
      const cov = ri.reduce((s, r, k) => s + (r - mean) * (rl[k] - mean), 0);
      const varI = ri.reduce((s, r) => s + (r - mean) ** 2, 0);
      const varL = rl.reduce((s, r) => s + (r - mean) ** 2, 0);
      expect(Math.abs(cov / Math.sqrt(varI * varL)), fam).toBeLessThan(0.6);
    }
  });

  it("matches its content hashes (no silent edits) and is reproduced by the generators", () => {
    for (const i of items) {
      const { contentHash, ...rest } = i;
      expect(createHash("sha256").update(stableStringify(rest)).digest("hex"), i.id).toBe(contentHash);
    }
    const regenerated = generateItemBank();
    expect(regenerated.items.length).toBe(items.length);
    for (let k = 0; k < items.length; k++) {
      const { contentHash: _h, ...frozen } = items[k];
      void _h;
      expect(stableStringify(regenerated.items[k]), items[k].id).toBe(stableStringify(frozen));
    }
  });

  it("covers every difficulty level in each adaptive domain", () => {
    for (const d of ["Gf", "Gv", "Gq", "Gc"] as const) {
      const levels = new Set(scored.filter((i) => i.domain === d).map((i) => i.difficulty.level));
      expect([...levels].sort(), d).toEqual([1, 2, 3, 4, 5]);
    }
  });
});

describe("response specifications", () => {
  it("choice items have unique option ids and contents, and the key is among them", () => {
    for (const i of items.filter((x) => x.response.kind === "choice")) {
      const r = choice(i);
      expect(new Set(r.options.map((o) => o.id)).size, i.id).toBe(r.options.length);
      expect(new Set(r.options.map((o) => stableStringify(o.content))).size, i.id).toBe(r.options.length);
      expect(r.options.some((o) => o.id === r.correctOptionId), i.id).toBe(true);
      expect(r.options.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("the scorer accepts the key and rejects every distractor", () => {
    for (const i of items) {
      const r = i.response;
      if (r.kind === "choice") {
        expect(scoreResponse(i, { kind: "choice", optionId: r.correctOptionId })).toBe(true);
        for (const o of r.options.filter((o) => o.id !== r.correctOptionId)) {
          expect(scoreResponse(i, { kind: "choice", optionId: o.id })).toBe(false);
        }
      } else if (r.kind === "numeric") {
        expect(scoreResponse(i, { kind: "numeric", value: r.correct })).toBe(true);
        expect(scoreResponse(i, { kind: "numeric", value: r.correct + 1 })).toBe(false);
      } else if (r.kind === "sequence") {
        expect(scoreResponse(i, { kind: "sequence", values: r.correct })).toBe(true);
        expect(scoreResponse(i, { kind: "sequence", values: [...r.correct].reverse() })).toBe(r.correct.length < 2 || r.correct.join() === [...r.correct].reverse().join());
      } else {
        expect(scoreResponse(i, { kind: "binary", value: r.correct })).toBe(true);
        expect(scoreResponse(i, { kind: "binary", value: (1 - r.correct) as 0 | 1 })).toBe(false);
      }
      expect(scoreResponse(i, null)).toBe(false);
    }
  });

  it("key positions are spread evenly across option slots", () => {
    const counts = new Map<number, number>();
    const pool = scored.filter((i) => i.response.kind === "choice");
    for (const i of pool) counts.set(keyIndex(i), (counts.get(keyIndex(i)) ?? 0) + 1);
    // Compare each slot's share with chance for the items that have that slot.
    for (const [slot, n] of counts) {
      const eligible = pool.filter((i) => choice(i).options.length > slot);
      const expected = eligible.reduce((s, i) => s + 1 / choice(i).options.length, 0);
      expect(Math.abs(n - expected) / Math.sqrt(expected), `slot ${slot}`).toBeLessThan(3.5);
    }
  });
});

describe("independent re-verification of keys", () => {
  it("matrices: the independent solver finds exactly the keyed option", () => {
    for (const i of byFamily("matrix")) {
      if (i.stimulus.type !== "matrix") throw new Error("bad stimulus");
      const figs = choice(i).options.map((o) => (o.content as { figure: FigureSpec }).figure);
      const res = solveMatrix(i.stimulus.cells, figs);
      expect(res.status, `${i.id}: ${"detail" in res ? res.detail : ""}`).toBe("unique");
      if (res.status === "unique") expect(res.optionIndex).toBe(keyIndex(i));
    }
  });

  it("figure series: the independent solver finds exactly the keyed option", () => {
    for (const i of byFamily("figure-series")) {
      if (i.stimulus.type !== "figure-series") throw new Error("bad stimulus");
      const figs = choice(i).options.map((o) => (o.content as { figure: FigureSpec }).figure);
      const res = solveSeries(i.stimulus.panels, figs);
      expect(res.status, i.id).toBe("unique");
      if (res.status === "unique") expect(res.optionIndex).toBe(keyIndex(i));
    }
  });

  it("deduction: keys are proven by exhaustive model enumeration", () => {
    for (const i of byFamily("deduction")) {
      const v = i.verification as Record<string, unknown>;
      const keyText = (choice(i).options[keyIndex(i)].content as { text: string }).text;
      if (v.kind === "order") {
        const orders = consistentOrders(v.labels as string[], v.premises as OrderPremise[]);
        expect(orders.length, i.id).toBeGreaterThan(0);
        if (v.question === "must") {
          const statements = v.statements as { text: string; above: string; below: string }[];
          const valid = statements.filter((s) => mustBeAbove(orders, s.above, s.below));
          expect(valid.length, i.id).toBe(1);
          expect(valid[0].text).toBe(keyText);
        } else {
          const labels = v.labels as string[];
          const pos = v.question === "top" ? 0 : v.question === "bottom" ? labels.length - 1 : 1;
          const answer = determinedAt(orders, pos);
          expect(answer, i.id).toBe(v.answerLabel);
          expect(keyText.endsWith(` ${answer}`)).toBe(true);
        }
      } else if (v.kind === "syllogism") {
        const premises = v.premises as Categorical[];
        const opts = v.options as { text: string; conclusion: Categorical | null }[];
        const valid = opts.filter((o) => o.conclusion && entails(premises, o.conclusion));
        if (valid.length === 0) expect(keyText, i.id).toMatch(/None of these/);
        else {
          expect(valid.length, i.id).toBe(1);
          expect(valid[0].text).toBe(keyText);
        }
      } else if (v.kind === "conditional") {
        const premises = v.premises as Formula[];
        const target = v.target as Formula;
        const yes = propEntails(premises, target);
        const no = propEntails(premises, not(target));
        expect(yes && no, `${i.id}: premises inconsistent`).toBe(false);
        const meaning = yes ? "yes" : no ? "no" : "unknown";
        const opts = v.options as { text: string; meaning: string }[];
        expect(opts.find((o) => o.meaning === meaning)!.text, i.id).toBe(keyText);
      } else {
        throw new Error(`${i.id}: missing verification data`);
      }
    }
  });

  it("2D rotation: exactly one option is rotation-equivalent to the target, and it is the key", () => {
    for (const i of byFamily("rotation-2d")) {
      if (i.stimulus.type !== "rotation-2d") throw new Error("bad stimulus");
      const target = canonicalC4(i.stimulus.target);
      const same = choice(i)
        .options.map((o, k) => ({ k, c: o.content }))
        .filter(({ c }) => c.type === "polyomino" && canonicalC4(c.cells) === target);
      expect(same.length, i.id).toBe(1);
      expect(same[0].k).toBe(keyIndex(i));
    }
  });

  it("3D rotation: exactly one option is the same object; every view shows every cube", () => {
    for (const i of byFamily("rotation-3d")) {
      if (i.stimulus.type !== "rotation-3d") throw new Error("bad stimulus");
      const target = canonical3(i.stimulus.target);
      const views = choice(i).options.map((o) => (o.content as { voxels: [number, number, number][] }).voxels);
      const same = views.map((v, k) => ({ k, v })).filter(({ v }) => canonical3(v) === target);
      expect(same.length, i.id).toBe(1);
      expect(same[0].k).toBe(keyIndex(i));
      for (const v of [i.stimulus.target, ...views]) {
        expect(Math.min(...cubeVisibility(v)), i.id).toBeGreaterThanOrEqual(0.25);
      }
      expect(new Set([i.stimulus.target, ...views].map(viewSignature)).size, i.id).toBe(views.length + 1);
    }
  });

  it("paper folding: exactly one option equals the geometrically unfolded pattern", () => {
    for (const i of byFamily("paper-folding")) {
      if (i.stimulus.type !== "paper-folding") throw new Error("bad stimulus");
      const key = unfold(i.stimulus.folds, i.stimulus.punches.map(fromUnit));
      const matches = choice(i)
        .options.map((o, k) => ({ k, holes: (o.content as { holes: [number, number][] }).holes.map(fromUnit) as Pt[] }))
        .filter(({ holes }) => samePattern(holes, key));
      expect(matches.length, i.id).toBe(1);
      expect(matches[0].k).toBe(keyIndex(i));
    }
  });

  it("number series: every simple rule in the solver's library agrees on the key", () => {
    for (const i of byFamily("number-series")) {
      if (i.stimulus.type !== "number-series" || i.response.kind !== "numeric") throw new Error("bad item");
      const v = solveNumberSeries(i.stimulus.terms);
      expect(v.status, `${i.id} ${JSON.stringify(v)}`).toBe("unique");
      if (v.status === "unique") expect(v.next).toBe(i.response.correct);
    }
  });

  it("balance problems: exact rational solution equals the key", () => {
    for (const i of byFamily("balance")) {
      if (i.stimulus.type !== "balance") throw new Error("bad stimulus");
      const v = solveBalance(i.stimulus.equations, i.stimulus.query, i.stimulus.unit);
      expect(v.status, i.id).toBe("unique");
      const keyText = (choice(i).options[keyIndex(i)].content as { text: string }).text;
      if (v.status === "unique") expect(String(v.value)).toBe(keyText);
    }
  });

  it("number matrices: exactly one value satisfies any relation in the library", () => {
    for (const i of byFamily("number-matrix")) {
      if (i.stimulus.type !== "number-matrix" || i.response.kind !== "numeric") throw new Error("bad item");
      const v = solveNumberMatrix(i.stimulus.cells);
      expect(v.status, `${i.id} ${JSON.stringify(v)}`).toBe("unique");
      if (v.status === "unique") expect(v.value).toBe(i.response.correct);
    }
  });

  it("span tasks: keys follow from the presented sequence and the task rule", () => {
    const LETTERS = /[A-Z]/;
    for (const i of items.filter((x) => x.domain === "Gwm")) {
      if (i.response.kind !== "sequence") throw new Error("bad response");
      const seq = i.stimulus.type === "span" ? i.stimulus.sequence : i.stimulus.type === "spatial-span" ? i.stimulus.sequence.map(String) : [];
      expect(new Set(seq).size, `${i.id} repeats`).toBe(seq.length);
      let expected: string[];
      if (i.family === "digit-span-backward") expected = [...seq].reverse();
      else if (i.family === "sequence-reordering")
        expected = [...seq.filter((x) => !LETTERS.test(x)).sort(), ...seq.filter((x) => LETTERS.test(x)).sort()];
      else expected = seq;
      expect(i.response.correct, i.id).toEqual(expected);
      for (const x of i.response.correct) expect(i.response.alphabet).toContain(x);
    }
  });

  it("speed trials: keys match the stimulus", () => {
    for (const i of byFamily("symbol-search")) {
      if (i.stimulus.type !== "symbol-search" || i.response.kind !== "binary") throw new Error("bad item");
      const stim = i.stimulus;
      const present = stim.targets.some((t) => stim.group.includes(t));
      expect(i.response.correct, i.id).toBe(present ? 0 : 1);
      expect(new Set(stim.group).size).toBe(stim.group.length);
    }
    for (const i of byFamily("visual-comparison")) {
      if (i.stimulus.type !== "visual-comparison" || i.response.kind !== "binary") throw new Error("bad item");
      expect(i.response.correct, i.id).toBe(i.stimulus.left === i.stimulus.right ? 0 : 1);
    }
    const ss = byFamily("symbol-search").filter((i) => !i.practice);
    const presentShare = ss.filter((i) => (i.response as { correct: number }).correct === 0).length / ss.length;
    expect(presentShare).toBeCloseTo(0.5, 1);
  });

  it("verbal items: the key is unique, distinct from the stem and has an explanation", () => {
    for (const i of items.filter((x) => x.domain === "Gc")) {
      const texts = choice(i).options.map((o) => (o.content as { text: string }).text.toLowerCase());
      expect(new Set(texts).size, i.id).toBe(texts.length);
      if (i.stimulus.type === "text" && i.family === "vocabulary") expect(texts).not.toContain(i.stimulus.question.toLowerCase());
      if (i.stimulus.type === "analogy") expect(texts).not.toContain(i.stimulus.c.toLowerCase());
    }
  });
});

describe("no context-blind shortcuts", () => {
  /**
   * A test-wise strategy for figural items is to pick the option whose
   * features are most common among the options (it is "central"). The
   * bisection-tree option design makes every perturbed attribute value occur
   * in exactly half of the options, which should leave this heuristic at
   * chance (1/8).
   */
  it("the most-typical-option heuristic performs at chance on matrices and series", () => {
    let credit = 0;
    const pool = [...byFamily("matrix"), ...byFamily("figure-series")].filter((i) => !i.practice);
    for (const i of pool) {
      const attrs = choice(i).options.map((o) => extractAttributes((o.content as { figure: FigureSpec }).figure));
      const names = [...attrs[0].keys()];
      const score = attrs.map((a) =>
        names.reduce((s, n) => s + attrs.filter((b) => JSON.stringify(b.get(n)) === JSON.stringify(a.get(n))).length, 0),
      );
      const best = Math.max(...score);
      const winners = score.map((s, k) => (s === best ? k : -1)).filter((k) => k >= 0);
      if (winners.includes(keyIndex(i))) credit += 1 / winners.length;
    }
    expect(credit / pool.length).toBeLessThan(0.2);
  });

  it("rotation items have no odd-one-out: the key's mirror class always has two members", () => {
    for (const i of byFamily("rotation-2d")) {
      const classes = choice(i).options.map((o) => canonicalD4((o.content as { cells: [number, number][] }).cells));
      expect(classes.filter((c) => c === classes[keyIndex(i)]).length, i.id).toBe(2);
    }
    for (const i of byFamily("rotation-3d")) {
      const cls = (v: [number, number, number][]) => [canonical3(v), canonical3(mirror3(v))].sort()[0];
      const classes = choice(i).options.map((o) => cls((o.content as { voxels: [number, number, number][] }).voxels));
      expect(classes.filter((c) => c === classes[keyIndex(i)]).length, i.id).toBe(2);
    }
  });

  it("paper folding: picking the most symmetric option is not a reliable shortcut", () => {
    const symmetry = (holes: Pt[]) => {
      const t = [
        ([x, y]: Pt): Pt => [16 - x, y],
        ([x, y]: Pt): Pt => [x, 16 - y],
        ([x, y]: Pt): Pt => [y, x],
        ([x, y]: Pt): Pt => [16 - y, 16 - x],
      ];
      return t.filter((f) => samePattern(holes.map(f), holes)).length;
    };
    let uniqueBest = 0;
    const pool = byFamily("paper-folding").filter((i) => !i.practice);
    for (const i of pool) {
      const sym = choice(i).options.map((o) => symmetry((o.content as { holes: [number, number][] }).holes.map(fromUnit)));
      const best = Math.max(...sym);
      if (sym[keyIndex(i)] === best && sym.filter((s) => s === best).length === 1) uniqueBest++;
    }
    expect(uniqueBest / pool.length).toBeLessThan(0.5);
  });
});
