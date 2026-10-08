import { describe, expect, it } from "vitest";
import { Rng } from "../random";
import { confidenceInterval, eap, mle } from "./estimation";
import { information, probability, testInformation, thetaOfMaxInformation, type ItemParameters } from "./irt";
import { combinedStatus, ParameterResolver, provisionalParameters, validateCalibrationSet, type CalibrationSet } from "./parameters";
import { chooseFamily, selectItem, type Candidate } from "./selection";
import { normalCdf, normalQuantile, quantile } from "./stats";
import { checkStop } from "./stopping";
import type { Item } from "../items/types";

const rasch = (b: number): ItemParameters => ({ a: 1, b, c: 0 });

describe("stats", () => {
  it("normal CDF and quantile are inverse and match reference values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.959963984540054)).toBeCloseTo(0.975, 6);
    expect(normalCdf(-1)).toBeCloseTo(0.158655, 5);
    for (const p of [0.001, 0.025, 0.2, 0.5, 0.8, 0.975, 0.999]) {
      expect(normalCdf(normalQuantile(p))).toBeCloseTo(p, 6);
    }
  });

  it("quantile uses linear interpolation", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([5], 0.9)).toBe(5);
  });
});

describe("IRT response functions", () => {
  it("P(θ = b) is halfway between the guessing floor and 1", () => {
    expect(probability(0.7, { a: 1.3, b: 0.7, c: 0 })).toBeCloseTo(0.5, 10);
    expect(probability(0.7, { a: 1.3, b: 0.7, c: 0.2 })).toBeCloseTo(0.6, 10);
  });

  it("probability is monotone increasing in θ", () => {
    const p = { a: 1.4, b: -0.3, c: 0.125 };
    let prev = 0;
    for (let t = -5; t <= 5; t += 0.1) {
      const cur = probability(t, p);
      expect(cur).toBeGreaterThan(prev);
      prev = cur;
    }
  });

  it("Rasch information peaks at b with value 0.25", () => {
    expect(information(1.5, rasch(1.5))).toBeCloseTo(0.25, 10);
    expect(information(0.5, rasch(1.5))).toBeLessThan(0.25);
  });

  it("3PL information peak is located where the closed form says", () => {
    const p = { a: 1.2, b: 0.4, c: 0.25 };
    let bestT = -10;
    let best = -1;
    for (let t = -4; t <= 4; t += 0.0005) {
      const i = information(t, p);
      if (i > best) {
        best = i;
        bestT = t;
      }
    }
    expect(thetaOfMaxInformation(p)).toBeCloseTo(bestT, 2);
    expect(thetaOfMaxInformation(p)).toBeGreaterThan(p.b);
  });

  it("guessing reduces the information an item carries", () => {
    expect(information(0, { a: 1, b: 0, c: 0.2 })).toBeLessThan(information(0, rasch(0)));
  });
});

describe("ability estimation", () => {
  it("EAP with no responses returns the prior", () => {
    const est = eap([]);
    expect(est.theta).toBeCloseTo(0, 6);
    expect(est.se).toBeCloseTo(1, 2);
  });

  it("a correct response raises the EAP estimate and an incorrect one lowers it (any θ, any item)", () => {
    const rng = new Rng(7);
    for (let trial = 0; trial < 200; trial++) {
      const history = Array.from({ length: rng.int(0, 8) }, () => ({
        params: { a: 0.5 + rng.next() * 1.5, b: rng.normal(0, 1.5), c: rng.pick([0, 0.125, 0.25]) },
        correct: rng.bool(),
      }));
      const before = eap(history).theta;
      const item = { a: 0.5 + rng.next() * 1.5, b: rng.normal(0, 1.5), c: rng.pick([0, 0.125, 0.25]) };
      expect(eap([...history, { params: item, correct: true }]).theta).toBeGreaterThan(before);
      expect(eap([...history, { params: item, correct: false }]).theta).toBeLessThan(before);
    }
  });

  it("each response reduces posterior uncertainty on average", () => {
    const responses = [
      { params: rasch(0), correct: true },
      { params: rasch(0.5), correct: false },
      { params: rasch(0.2), correct: true },
    ];
    expect(eap(responses).se).toBeLessThan(eap(responses.slice(0, 1)).se);
  });

  it("MLE is undefined for all-correct and all-incorrect patterns", () => {
    expect(mle([{ params: rasch(0), correct: true }]).kind).toBe("undefined");
    expect(mle([{ params: rasch(0), correct: false }, { params: rasch(1), correct: false }])).toEqual({
      kind: "undefined",
      reason: "all-incorrect",
    });
  });

  it("MLE solves the symmetric Rasch case exactly", () => {
    const out = mle([
      { params: rasch(-1), correct: true },
      { params: rasch(1), correct: false },
    ]);
    expect(out.kind).toBe("estimate");
    if (out.kind === "estimate") expect(out.theta).toBeCloseTo(0, 5);
  });

  it("MLE and EAP recover a known ability from a long simulated test", () => {
    const rng = new Rng(2024);
    const trueTheta = 1.2;
    const responses = Array.from({ length: 400 }, () => {
      const params = { a: 0.8 + rng.next(), b: rng.normal(0, 1.5), c: 0 };
      return { params, correct: rng.next() < probability(trueTheta, params) };
    });
    const m = mle(responses);
    expect(m.kind).toBe("estimate");
    if (m.kind === "estimate") {
      expect(Math.abs(m.theta - trueTheta)).toBeLessThan(0.3);
      expect(m.se).toBeCloseTo(1 / Math.sqrt(testInformation(m.theta, responses.map((r) => r.params))), 6);
    }
    expect(Math.abs(eap(responses).theta - trueTheta)).toBeLessThan(0.3);
  });

  it("confidence intervals are symmetric normal-theory intervals", () => {
    const [lo, hi] = confidenceInterval({ theta: 0.5, se: 0.4 });
    expect(lo).toBeCloseTo(0.5 - 1.96 * 0.4, 2);
    expect(hi).toBeCloseTo(0.5 + 1.96 * 0.4, 2);
  });
});

describe("adaptive selection", () => {
  const bank: Candidate[] = Array.from({ length: 41 }, (_, i) => ({
    id: `X${String(i).padStart(2, "0")}`,
    family: i % 2 === 0 ? "matrix" : "series",
    params: rasch(-2 + i * 0.1),
  }));

  it("with k = 1 and no balancing it chooses the most informative item", () => {
    const sel = selectItem(bank, { theta: 0.73, administeredFamilies: [], randomesqueK: 1 }, new Rng(1));
    expect(sel?.item.params.b).toBeCloseTo(0.7, 6);
  });

  it("begins at medium difficulty when the estimate is at the prior mean", () => {
    const sel = selectItem(bank, { theta: 0, administeredFamilies: [], randomesqueK: 1 }, new Rng(1));
    expect(Math.abs(sel!.item.params.b)).toBeLessThan(0.11);
  });

  it("moves to harder items after a correct answer and easier ones after an error", () => {
    const first = bank.find((c) => c.params.b === 0 || Math.abs(c.params.b) < 1e-9)!;
    const remaining = bank.filter((c) => c !== first);
    const up = eap([{ params: first.params, correct: true }]).theta;
    const down = eap([{ params: first.params, correct: false }]).theta;
    const ctx = { administeredFamilies: [], randomesqueK: 1 };
    const nextUp = selectItem(remaining, { ...ctx, theta: up }, new Rng(3))!;
    const nextDown = selectItem(remaining, { ...ctx, theta: down }, new Rng(3))!;
    expect(nextUp.item.params.b).toBeGreaterThan(first.params.b);
    expect(nextDown.item.params.b).toBeLessThan(first.params.b);
  });

  it("randomesque selection stays within the top-k most informative items", () => {
    const rng = new Rng(99);
    const ranked = [...bank].sort(
      (x, y) => information(0.5, y.params) - information(0.5, x.params),
    );
    const top3 = new Set(ranked.slice(0, 3).map((c) => c.id));
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const sel = selectItem(bank, { theta: 0.5, administeredFamilies: [], randomesqueK: 3 }, rng)!;
      expect(top3.has(sel.item.id)).toBe(true);
      seen.add(sel.item.id);
    }
    expect(seen.size).toBe(3);
  });

  it("content balancing tracks blueprint proportions", () => {
    const rng = new Rng(5);
    const administered: string[] = [];
    const targets = { matrix: 0.5, series: 0.25, deduction: 0.25 };
    for (let i = 0; i < 20; i++) {
      const fam = chooseFamily(new Set(["matrix", "series", "deduction"]), administered, targets, rng)!;
      administered.push(fam);
    }
    const share = (f: string) => administered.filter((x) => x === f).length / administered.length;
    expect(share("matrix")).toBeCloseTo(0.5, 1);
    expect(share("series")).toBeCloseTo(0.25, 1);
    expect(share("deduction")).toBeCloseTo(0.25, 1);
  });

  it("falls back to the families that still have items", () => {
    const fam = chooseFamily(new Set(["series"]), ["series"], { matrix: 0.9, series: 0.1 }, new Rng(1));
    expect(fam).toBe("series");
  });
});

describe("stopping rules", () => {
  const rule = { minItems: 5, maxItems: 10, targetSE: 0.4, maxDurationSec: 600 };
  it("respects the minimum before stopping on precision", () => {
    expect(checkStop({ itemsAdministered: 3, se: 0.2, elapsedSec: 10, itemsRemaining: 50 }, rule)).toBeNull();
    expect(checkStop({ itemsAdministered: 5, se: 0.39, elapsedSec: 10, itemsRemaining: 50 }, rule)).toBe(
      "target-precision",
    );
  });
  it("stops on maximum length, time and bank exhaustion", () => {
    expect(checkStop({ itemsAdministered: 10, se: 0.6, elapsedSec: 10, itemsRemaining: 50 }, rule)).toBe("max-items");
    expect(checkStop({ itemsAdministered: 6, se: 0.6, elapsedSec: 601, itemsRemaining: 50 }, rule)).toBe("time-limit");
    expect(checkStop({ itemsAdministered: 6, se: 0.6, elapsedSec: 1, itemsRemaining: 0 }, rule)).toBe(
      "bank-exhausted",
    );
  });
});

describe("parameter resolution", () => {
  const item = {
    id: "T-1",
    version: 2,
    difficulty: { logit: 0.8, level: 4, method: "test", features: {} },
    response: {
      kind: "choice",
      options: Array.from({ length: 8 }, (_, i) => ({ id: `o${i}`, content: { type: "text", text: String(i) } })),
      correctOptionId: "o0",
    },
  } as unknown as Item;

  const calibration: CalibrationSet = {
    id: "fixture-cal",
    status: "empirical",
    model: "3PL",
    bankVersion: "test",
    estimation: "test fixture — not real data",
    sampleSize: 1000,
    population: "fixture",
    collectedFrom: "2026-01-01",
    collectedTo: "2026-02-01",
    scaleDefinition: "fixture",
    modelChecks: [],
    items: { "T-1@2": { a: 1.6, b: 0.1, c: 0.1, n: 1000 } },
  };

  it("provisional parameters use the a priori logit, a = 1 and c = 1/k", () => {
    expect(provisionalParameters(item)).toEqual({ a: 1, b: 0.8, c: 1 / 8 });
    expect(new ParameterResolver().resolve(item).status).toBe("provisional");
  });

  it("calibrated parameters are used only for the matching item version", () => {
    const resolver = new ParameterResolver(calibration);
    expect(resolver.resolve(item)).toEqual({ params: { a: 1.6, b: 0.1, c: 0.1 }, status: "calibrated", source: "fixture-cal" });
    expect(resolver.resolve({ ...item, version: 3 }).status).toBe("provisional");
  });

  it("rejects malformed calibration sets", () => {
    const bad = { ...calibration, model: "2PL" as const, items: { "T-1": { a: -1, b: 0, c: 0.2, n: 0 } } };
    expect(validateCalibrationSet(bad).length).toBeGreaterThanOrEqual(4);
    expect(() => new ParameterResolver(bad)).toThrow();
  });

  it("a section is calibrated only if every response is calibrated by the same set", () => {
    expect(combinedStatus([{ status: "calibrated", source: "A" }, { status: "calibrated", source: "A" }]).status).toBe(
      "calibrated",
    );
    expect(combinedStatus([{ status: "calibrated", source: "A" }, { status: "provisional", source: "p" }]).status).toBe(
      "provisional",
    );
    expect(combinedStatus([{ status: "calibrated", source: "A" }, { status: "calibrated", source: "B" }]).status).toBe(
      "provisional",
    );
  });
});
