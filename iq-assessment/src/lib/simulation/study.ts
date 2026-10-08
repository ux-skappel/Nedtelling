/**
 * Monte Carlo study of the adaptive engine.
 *
 * SIMULATION IS NOT VALIDATION. Simulees answer according to an IRT model we
 * choose. These results describe how the scoring machinery behaves *if* the
 * model were true (condition "provisional") and how robust it is to plausible
 * model error (condition "misspecified"). They say nothing about whether the
 * items measure intelligence in real people.
 *
 * Every simulee runs through the real engine (`createSession` + the same
 * selection, estimation and stopping code the browser uses).
 */

import bankJson from "@/data/item-bank.json";
import { createSession, ItemBankIndex, type EngineContext } from "../assessment/engine";
import { DEFAULT_SETTINGS, UNKNOWN_ENVIRONMENT, type CatSectionState, type Session } from "../assessment/session";
import type { Mode } from "../assessment/blueprint";
import type { Domain, ItemBank } from "../items/types";
import { ParameterResolver } from "../psychometrics/parameters";
import { scoreSession } from "../scoring/development";
import { correlation, mean, sd, variance } from "../psychometrics/stats";
import { Rng } from "../random";
import { runHeadless, type GeneratingModel } from "./respondent";

export const CONDITIONS: Record<string, GeneratingModel> = {
  provisional: { kind: "provisional" },
  misspecified: { kind: "misspecified", seed: 20261008, bNoiseSD: 0.5, aLogSD: 0.3, guessScale: [0.6, 1.1] },
};

export interface GridRow {
  theta: number;
  n: number;
  meanEstimate: number;
  bias: number;
  rmse: number;
  meanSE: number;
  empiricalSD: number;
  coverage95: number;
  meanItems: number;
  meanAccuracy: number;
  stoppedOnPrecision: number;
}

export interface PopulationSummary {
  n: number;
  marginalReliability: number;
  /** Squared correlation between true and estimated ability. */
  trueScoreR2: number;
  meanItems: number;
  meanSE: number;
}

export interface StudyResult {
  mode: Mode;
  domain: Domain;
  condition: string;
  grid: GridRow[];
  population: PopulationSummary;
}

let bankIndex: ItemBankIndex | null = null;
function bank(): ItemBankIndex {
  bankIndex ??= new ItemBankIndex(bankJson as unknown as ItemBank);
  return bankIndex;
}

interface Outcome {
  estimate: number;
  se: number;
  items: number;
  accuracy: number;
  stoppedOnPrecision: boolean;
}

function simulateOne(mode: Mode, domain: Domain, theta: number, model: GeneratingModel, seed: number): Outcome {
  let t = 0;
  const ctx: EngineContext = { bank: bank(), resolver: new ParameterResolver(), now: () => (t += 1000) };
  const session: Session = createSession(
    {
      id: `sim-${seed}`,
      mode,
      seed,
      participant: { ageYears: null, englishFirstLanguage: null, researchConsent: false },
      settings: DEFAULT_SETTINGS,
      environment: UNKNOWN_ENVIRONMENT,
    },
    ctx,
  );
  // Only the target domain's sections are administered.
  const done = runHeadless(session, { theta: { [domain]: theta }, model, rng: new Rng(seed ^ 0x9e3779b9) }, ctx, 4000, domain);
  const result = scoreSession(done).domains.find((d) => d.domain === domain);
  if (!result || result.theta === null || result.se === null) throw new Error(`No ${domain} estimate in ${mode} mode`);
  const cat = done.sections.filter((s): s is CatSectionState => s.kind === "cat" && s.responses[0]?.domain === domain);
  return {
    estimate: result.theta,
    se: result.se,
    items: result.items,
    accuracy: result.accuracy ?? 0,
    stoppedOnPrecision: cat.some((c) => c.stopReason === "target-precision"),
  };
}

export function runStudy(opts: {
  mode: Mode;
  domain: Domain;
  condition: keyof typeof CONDITIONS;
  grid: number[];
  repsPerTheta: number;
  populationN: number;
  seed?: number;
}): StudyResult {
  const model = CONDITIONS[opts.condition];
  const rng = new Rng(opts.seed ?? 1);
  const grid: GridRow[] = opts.grid.map((theta) => {
    const outs = Array.from({ length: opts.repsPerTheta }, () => simulateOne(opts.mode, opts.domain, theta, model, rng.int(1, 2 ** 31)));
    const est = outs.map((o) => o.estimate);
    const err = est.map((e) => e - theta);
    return {
      theta,
      n: outs.length,
      meanEstimate: mean(est),
      bias: mean(err),
      rmse: Math.sqrt(mean(err.map((e) => e * e))),
      meanSE: mean(outs.map((o) => o.se)),
      empiricalSD: sd(est),
      coverage95: mean(outs.map((o) => (Math.abs(o.estimate - theta) <= 1.96 * o.se ? 1 : 0))),
      meanItems: mean(outs.map((o) => o.items)),
      meanAccuracy: mean(outs.map((o) => o.accuracy)),
      stoppedOnPrecision: mean(outs.map((o) => (o.stoppedOnPrecision ? 1 : 0))),
    };
  });
  const thetas = Array.from({ length: opts.populationN }, () => rng.normal());
  const pop = thetas.map((theta) => ({ theta, ...simulateOne(opts.mode, opts.domain, theta, model, rng.int(1, 2 ** 31)) }));
  const estimates = pop.map((p) => p.estimate);
  const ses = pop.map((p) => p.se);
  const population: PopulationSummary = {
    n: pop.length,
    marginalReliability: variance(estimates) / (variance(estimates) + mean(ses.map((s) => s * s))),
    trueScoreR2: correlation(thetas, estimates) ** 2,
    meanItems: mean(pop.map((p) => p.items)),
    meanSE: mean(ses),
  };
  return { mode: opts.mode, domain: opts.domain, condition: opts.condition, grid, population };
}
