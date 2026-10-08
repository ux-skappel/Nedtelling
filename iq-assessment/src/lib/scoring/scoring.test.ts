import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import bankJson from "@/data/item-bank.json";
import { FIXTURE_NOT_REAL_calibration, FIXTURE_NOT_REAL_norms } from "../../../tests/fixtures/FIXTURE_NOT_REAL_norms";
import { createSession, ItemBankIndex, type EngineContext } from "../assessment/engine";
import { DEFAULT_SETTINGS, UNKNOWN_ENVIRONMENT, type CatSectionState, type Session } from "../assessment/session";
import type { ItemBank } from "../items/types";
import { classicalItemAnalysis, cronbachAlpha, mantelHaenszel, marginalReliability, toCsv, toLongFormat, type MhInput } from "../norms/analysis";
import { ACTIVE_CALIBRATION, ACTIVE_NORM_TABLE } from "../norms/registry";
import { ParameterResolver } from "../psychometrics/parameters";
import { probability } from "../psychometrics/irt";
import { Rng } from "../random";
import { runHeadless, type Simulee } from "../simulation/respondent";
import { scoreSession } from "./development";
import { relativeProfile } from "./profile";
import { checkNormEligibility, normReferencedScores } from "./validated";

const rawBank = bankJson as unknown as ItemBank;
const bank = new ItemBankIndex(rawBank);

function ctx(resolver = new ParameterResolver()): EngineContext {
  let t = 1_700_000_000_000;
  return { bank, resolver, now: () => (t += 10) };
}

function run(mode: "quick" | "full", theta: number, c = ctx(), opts: Partial<Session["participant"]> = {}, seed = 3): Session {
  const s = createSession(
    {
      id: `s-${mode}-${theta}-${seed}`,
      mode,
      seed,
      participant: { ageYears: 35, englishFirstLanguage: "yes", researchConsent: true, ...opts },
      settings: DEFAULT_SETTINGS,
      environment: UNKNOWN_ENVIRONMENT,
    },
    c,
  );
  const sim: Simulee = {
    theta: { Gf: theta, Gv: theta, Gq: theta, Gwm: theta, Gs: theta, Gc: theta },
    model: { kind: "provisional" },
    rng: new Rng(seed),
  };
  return runHeadless(s, sim, c);
}

describe("development scoring", () => {
  it("reports raw performance and a provisional estimate with uncertainty for quick mode", () => {
    const report = scoreSession(run("quick", 0.8));
    expect(report.kind).toBe("development");
    expect(report.parameterStatus).toBe("provisional");
    expect(report.domains).toHaveLength(1);
    const gf = report.domains[0];
    expect(gf.domain).toBe("Gf");
    expect(gf.theta).not.toBeNull();
    expect(gf.se).toBeGreaterThan(0);
    expect(gf.ci95![0]).toBeLessThan(gf.theta!);
    expect(gf.ci95![1]).toBeGreaterThan(gf.theta!);
    expect(gf.level).not.toBeNull();
    expect(gf.items).toBe(gf.trajectory.length);
    expect(report.profile).toBeNull();
  });

  it("never contains IQ-like or norm-referenced quantities", () => {
    const json = JSON.stringify(scoreSession(run("full", 1.2)));
    expect(json).not.toMatch(/"iq"|percentile|standardScore|"z"/i);
  });

  it("covers all six domains in full mode, with rate scoring for speed and spans for working memory", () => {
    const report = scoreSession(run("full", 0.3));
    expect(report.domains.map((d) => d.domain)).toEqual(["Gf", "Gv", "Gq", "Gwm", "Gs", "Gc"]);
    const gs = report.domains.find((d) => d.domain === "Gs")!;
    expect(gs.scoring).toBe("rate");
    expect(gs.theta).toBeNull();
    expect(gs.speed!.blocks).toHaveLength(2);
    expect(gs.speed!.baselineMedianMs).toBeGreaterThan(0);
    const gwm = report.domains.find((d) => d.domain === "Gwm")!;
    expect(gwm.spans).toHaveLength(4);
    for (const sp of gwm.spans!) expect(sp.trialsTotal).toBeGreaterThanOrEqual(2);
    expect(report.profile).not.toBeNull();
    expect(report.profile!.length).toBe(5);
    expect(report.completed).toBe(true);
  });

  it("gives higher provisional estimates to stronger simulees", () => {
    const est = (theta: number) =>
      [1, 2, 3, 4, 5].map((seed) => scoreSession(run("quick", theta, ctx(), {}, seed)).domains[0].theta!).reduce((a, b) => a + b) / 5;
    expect(est(-1.5)).toBeLessThan(est(0));
    expect(est(0)).toBeLessThan(est(1.5));
  });

  it("flags rapid guessing as questionable validity", () => {
    const s = run("quick", 0);
    const gf = s.sections[0] as CatSectionState;
    gf.responses = gf.responses.map((r) => ({ ...r, rtMs: 400, flags: ["rapid"] }));
    const report = scoreSession(s);
    expect(report.validity.level).toBe("questionable");
    expect(report.validity.warnings.join(" ")).toMatch(/guessing/);
  });

  it("measures time the window was hidden from paired visibility events", () => {
    const s = run("quick", 0);
    s.events.push({ type: "visibility-hidden", at: 1000 }, { type: "visibility-visible", at: 91_000 });
    const report = scoreSession(s);
    expect(report.validity.hiddenMs).toBe(90_000);
    expect(report.validity.level).not.toBe("ok");
  });
});

describe("relative profile", () => {
  it("does not call ordinary fluctuations strengths or weaknesses", () => {
    const p = relativeProfile([
      { domain: "Gf", theta: 0.2, se: 0.5 },
      { domain: "Gv", theta: -0.1, se: 0.5 },
      { domain: "Gq", theta: 0.0, se: 0.5 },
    ]);
    expect(p.every((e) => e.classification === "no-reliable-difference")).toBe(true);
  });

  it("identifies a large, precisely measured deviation", () => {
    const p = relativeProfile([
      { domain: "Gf", theta: 2, se: 0.2 },
      { domain: "Gv", theta: 0, se: 0.2 },
      { domain: "Gq", theta: 0, se: 0.2 },
      { domain: "Gc", theta: 0, se: 0.2 },
    ]);
    expect(p[0].classification).toBe("relative-strength");
    expect(p.slice(1).every((e) => e.classification !== "relative-strength")).toBe(true);
  });
});

describe("validated scoring is locked without real norms", () => {
  it("ships no norm table and no calibration", () => {
    expect(ACTIVE_NORM_TABLE).toBeNull();
    expect(ACTIVE_CALIBRATION).toBeNull();
  });

  it("refuses norm-referenced scores for provisional sessions and explains why", () => {
    const s = run("quick", 0.5);
    const report = scoreSession(s);
    const e = checkNormEligibility(s, report, ACTIVE_NORM_TABLE, ACTIVE_CALIBRATION);
    expect(e.eligible).toBe(false);
    if (!e.eligible) expect(e.reasons[0]).toMatch(/No validated normative data/);
    expect(() => normReferencedScores(s, report, ACTIVE_NORM_TABLE, ACTIVE_CALIBRATION)).toThrow();
  });

  it("refuses even with norms if the parameters were provisional", () => {
    const s = run("quick", 0.5);
    const e = checkNormEligibility(s, scoreSession(s), FIXTURE_NOT_REAL_norms, FIXTURE_NOT_REAL_calibration(rawBank.items));
    expect(e.eligible).toBe(false);
    if (!e.eligible) expect(e.reasons.join(" ")).toMatch(/provisional/);
  });

  it("refuses without an age, and for non-standard administration", () => {
    const cal = FIXTURE_NOT_REAL_calibration(rawBank.items);
    const c = ctx(new ParameterResolver(cal));
    const s = run("quick", 0.5, c, { ageYears: null });
    s.settings = { ...s.settings, extendedTime: true };
    const e = checkNormEligibility(s, scoreSession(s), FIXTURE_NOT_REAL_norms, cal);
    expect(e.eligible).toBe(false);
    if (!e.eligible) {
      expect(e.reasons.join(" ")).toMatch(/Age was not provided/);
      expect(e.reasons.join(" ")).toMatch(/non-standard/);
    }
  });

  it("with (fixture) calibrated parameters and norms, applies IQ = 100 + 15z correctly", () => {
    const cal = FIXTURE_NOT_REAL_calibration(rawBank.items);
    const c = ctx(new ParameterResolver(cal));
    const s = run("quick", 0.5, c);
    const report = scoreSession(s);
    expect(report.parameterStatus).toBe("calibrated");
    expect(checkNormEligibility(s, report, FIXTURE_NOT_REAL_norms, cal)).toEqual({ eligible: true });
    const nr = normReferencedScores(s, report, FIXTURE_NOT_REAL_norms, cal);
    const gf = nr.domains.find((d) => d.domain === "Gf")!;
    const theta = report.domains[0].theta!;
    expect(gf.z).toBeCloseTo(theta, 10); // fixture norms: mean 0, SD 1
    expect(gf.standardScore).toBe(Math.round(100 + 15 * theta));
    expect(gf.ci95[0]).toBeLessThan(gf.standardScore);
    expect(gf.ci95[1]).toBeGreaterThan(gf.standardScore);
    expect(nr.composite).toBeNull(); // quick mode lacks the composite's domains
  });

  it("maps the norm mean to 100 / 50th percentile and +1 SD to 115 / ~84th", () => {
    const cal = FIXTURE_NOT_REAL_calibration(rawBank.items);
    const c = ctx(new ParameterResolver(cal));
    const s = run("quick", 0, c);
    const report = scoreSession(s);
    for (const [theta, ss, pct] of [
      [0, 100, 50],
      [1, 115, 84.1],
      [-2, 70, 2.3],
    ] as const) {
      report.domains[0].theta = theta;
      const gf = normReferencedScores(s, report, FIXTURE_NOT_REAL_norms, cal).domains[0];
      expect(gf.standardScore).toBe(ss);
      expect(gf.percentile).toBeCloseTo(pct, 0);
    }
  });

  it("caps scores at the range the norms support", () => {
    const cal = FIXTURE_NOT_REAL_calibration(rawBank.items);
    const c = ctx(new ParameterResolver(cal));
    const s = run("quick", 0, c);
    const report = scoreSession(s);
    report.domains[0].theta = 5;
    const gf = normReferencedScores(s, report, FIXTURE_NOT_REAL_norms, cal).domains[0];
    expect(gf.standardScore).toBe(145);
    expect(gf.beyondRange).toBe(true);
  });

  it("application code never imports test fixtures", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : [p];
      });
    const offenders = walk(join(__dirname, "../.."))
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => /from\s+["'][^"']*FIXTURE_NOT_REAL/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("analysis utilities", () => {
  it("Mantel–Haenszel finds no DIF when groups share item parameters, and large DIF when they do not", () => {
    const rng = new Rng(8);
    const sample = (shiftForFocal: number): MhInput[] =>
      Array.from({ length: 4000 }, () => {
        const group = rng.bool() ? 1 : 0;
        const theta = rng.normal();
        const b = group === 1 ? shiftForFocal : 0;
        const correct = rng.next() < probability(theta, { a: 1.3, b, c: 0 }) ? 1 : 0;
        return { group: group as 0 | 1, stratum: Math.round(theta * 2), correct: correct as 0 | 1 };
      });
    expect(mantelHaenszel(sample(0)).ets).toBe("A");
    const dif = mantelHaenszel(sample(1.2));
    expect(dif.ets).toBe("C");
    expect(dif.deltaMH).toBeLessThan(0); // harder for the focal group
  });

  it("marginal reliability follows its definition", () => {
    expect(marginalReliability([-1, 0, 1, 2, -2], [0.5, 0.5, 0.5, 0.5, 0.5])).toBeCloseTo(2.5 / (2.5 + 0.25), 10);
  });

  it("Cronbach's alpha and item–rest correlations detect a miskeyed item", () => {
    const rng = new Rng(9);
    const matrix = Array.from({ length: 800 }, () => {
      const theta = rng.normal();
      const row: number[] = Array.from({ length: 10 }, (_, j) => (rng.next() < probability(theta, { a: 1.5, b: -1 + j * 0.2, c: 0 }) ? 1 : 0));
      row[9] = 1 - row[9]; // simulate a miskeyed item
      return row;
    });
    expect(cronbachAlpha(matrix.map((r) => r.slice(0, 9)))).toBeGreaterThan(0.6);
    const stats = classicalItemAnalysis(matrix);
    expect(stats[9].itemRest).toBeLessThan(0);
    expect(stats[0].itemRest).toBeGreaterThan(0.2);
  });

  it("exports long-format data only for consenting participants and escapes CSV", () => {
    const yes = run("quick", 0, ctx(), { researchConsent: true }, 1);
    const no = run("quick", 0, ctx(), { researchConsent: false }, 2);
    const rows = toLongFormat([yes, no]);
    expect(rows.length).toBe((yes.sections[0] as CatSectionState).responses.length);
    expect(new Set(rows.map((r) => r.session_id))).toEqual(new Set([yes.id]));
    expect(toCsv([{ a: 'x,"y"', b: 2 }])).toBe('a,b\n"x,""y""",2\n');
  });
});
