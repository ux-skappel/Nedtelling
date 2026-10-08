/**
 * Simulated test-takers, used by the test suite and the simulation study.
 *
 * SIMULATION IS NOT VALIDATION. A simulee answers according to an IRT model
 * that we choose; agreement between its "true" ability and the engine's
 * estimate only shows that the engine is internally consistent with that
 * model. It says nothing about whether the items measure intelligence in
 * real people.
 */

import { Rng } from "../random";
import { probability, type ItemParameters } from "../psychometrics/irt";
import { provisionalParameters } from "../psychometrics/parameters";
import type { Domain, Item, ResponseValue } from "../items/types";
import {
  beginSection,
  currentView,
  submitBaseline,
  submitItem,
  submitPractice,
  submitSpeedBlock,
  type EngineContext,
} from "../assessment/engine";
import type { Session, SpeedTrialRecord } from "../assessment/session";

export type GeneratingModel =
  /** Responses follow exactly the provisional parameters the engine uses. */
  | { kind: "provisional" }
  /**
   * Responses follow "true" parameters that differ from the provisional ones
   * (random discrimination, shifted difficulty, a different guessing rate),
   * as real calibrated parameters surely will.
   */
  | { kind: "misspecified"; seed: number; bNoiseSD: number; aLogSD: number; guessScale: [number, number] };

export function trueParameters(item: Item, model: GeneratingModel): ItemParameters {
  const p = provisionalParameters(item);
  if (model.kind === "provisional") return p;
  const rng = new Rng((model.seed ^ hash(item.id)) >>> 0);
  const a = Math.exp(rng.normal(0, model.aLogSD));
  const b = p.b + rng.normal(0, model.bNoiseSD);
  const scale = model.guessScale[0] + rng.next() * (model.guessScale[1] - model.guessScale[0]);
  return { a, b, c: Math.min(0.5, p.c * scale) };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface Simulee {
  theta: Partial<Record<Domain, number>>;
  model: GeneratingModel;
  rng: Rng;
  /** Mean response time multiplier (1 = the item's estimated time). */
  pace?: number;
}

/** A response value that is correct with the model probability. */
export function simulateResponse(item: Item, sim: Simulee): { response: ResponseValue; correct: boolean } {
  const theta = sim.theta[item.domain] ?? 0;
  const p = probability(theta, trueParameters(item, sim.model));
  const correct = sim.rng.next() < p;
  const r = item.response;
  switch (r.kind) {
    case "choice": {
      const wrong = r.options.filter((o) => o.id !== r.correctOptionId);
      return { response: { kind: "choice", optionId: correct ? r.correctOptionId : sim.rng.pick(wrong).id }, correct };
    }
    case "numeric":
      return { response: { kind: "numeric", value: correct ? r.correct : r.correct + sim.rng.pick([-2, -1, 1, 2]) }, correct };
    case "sequence": {
      if (correct) return { response: { kind: "sequence", values: r.correct }, correct };
      const wrong = [...r.correct];
      if (wrong.length > 1) [wrong[0], wrong[1]] = [wrong[1], wrong[0]];
      else wrong[0] = r.alphabet.find((x) => x !== wrong[0])!;
      return { response: { kind: "sequence", values: wrong }, correct };
    }
    case "binary":
      return { response: { kind: "binary", value: correct ? r.correct : ((1 - r.correct) as 0 | 1) }, correct };
  }
}

/** Drive a whole session to completion with a simulee. */
export function runHeadless(session: Session, sim: Simulee, ctx: EngineContext, maxSteps = 2000): Session {
  let s = session;
  for (let step = 0; step < maxSteps; step++) {
    const view = currentView(s, ctx);
    switch (view.type) {
      case "complete":
        return s;
      case "section-intro":
        s = beginSection(s, ctx);
        break;
      case "practice":
        s = submitPractice(s, { itemId: view.item.id, response: simulateResponse(view.item, sim).response, rtMs: 5000 }, ctx);
        break;
      case "item":
      case "span-trial": {
        const { response } = simulateResponse(view.item, sim);
        const pace = sim.pace ?? 1;
        const rtMs = Math.round(view.item.estimatedTimeSec * 1000 * pace * (0.6 + 0.8 * sim.rng.next()));
        s = submitItem(s, { itemId: view.item.id, response, rtMs, timedOut: false }, ctx);
        break;
      }
      case "speed-baseline":
        s = submitBaseline(
          s,
          Array.from({ length: view.trials }, () => ({ foreperiodMs: 1200, rtMs: 280 + Math.round(sim.rng.next() * 60), anticipation: false })),
          ctx,
        );
        break;
      case "speed-block": {
        const theta = sim.theta.Gs ?? 0;
        const meanRt = 1600 * Math.exp(-0.25 * theta);
        const trials: SpeedTrialRecord[] = [];
        let elapsed = 0;
        for (const item of view.trials) {
          const rt = Math.round(meanRt * (0.7 + 0.6 * sim.rng.next()));
          if (elapsed + rt > view.block.durationSec * 1000) break;
          elapsed += rt;
          const { response, correct } = simulateResponse(item, { ...sim, theta: { ...sim.theta, Gs: 2.5 } });
          trials.push({ itemId: item.id, response: (response as { value: 0 | 1 }).value, correct, rtMs: rt });
        }
        s = submitSpeedBlock(
          s,
          {
            task: view.block.task,
            durationMs: view.block.durationSec * 1000,
            trials,
            practice: [],
            frameIntervalMs: 16.7,
            inputModality: "keyboard",
            interrupted: false,
          },
          ctx,
        );
        break;
      }
    }
  }
  throw new Error("Session did not finish within the step limit");
}
