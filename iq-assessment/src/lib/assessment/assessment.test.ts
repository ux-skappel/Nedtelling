import { describe, expect, it } from "vitest";
import bankJson from "@/data/item-bank.json";
import type { ItemBank } from "../items/types";
import { ParameterResolver } from "../psychometrics/parameters";
import { Rng } from "../random";
import { runHeadless, simulateResponse, type Simulee } from "../simulation/respondent";
import { FULL_BLUEPRINT, QUICK_BLUEPRINT } from "./blueprint";
import {
  beginSection,
  createSession,
  currentView,
  endEarly,
  heartbeat,
  ItemBankIndex,
  markPresented,
  rapidThresholdMs,
  resumeSession,
  submitBaseline,
  submitItem,
  submitPractice,
  submitSpeedBlock,
  type EngineContext,
} from "./engine";
import { LocalSessionRepository, MemoryStorage, migrateSession } from "./repository";
import { DEFAULT_SETTINGS, UNKNOWN_ENVIRONMENT, type CatSectionState, type Session, type SpanSectionState } from "./session";
import { ResponseTimer } from "./timing";

const bank = new ItemBankIndex(bankJson as unknown as ItemBank);

function ctxAt(start = 1_700_000_000_000): EngineContext & { advance(ms: number): void } {
  let t = start;
  return { bank, resolver: new ParameterResolver(), now: () => t, advance: (ms) => (t += ms) };
}

function newSession(mode: "quick" | "full", ctx: EngineContext, seed = 42): Session {
  return createSession(
    {
      id: `test-${mode}-${seed}`,
      mode,
      seed,
      participant: { ageYears: 30, englishFirstLanguage: "yes", researchConsent: false },
      settings: DEFAULT_SETTINGS,
      environment: UNKNOWN_ENVIRONMENT,
    },
    ctx,
  );
}

const simulee = (theta: number, seed = 1): Simulee => ({
  theta: { Gf: theta, Gv: theta, Gq: theta, Gwm: theta, Gs: theta, Gc: theta },
  model: { kind: "provisional" },
  rng: new Rng(seed),
});

describe("blueprints", () => {
  it("quick mode is a single fluid-reasoning section; full mode covers all six domains", () => {
    expect(QUICK_BLUEPRINT.sections.map((s) => s.domain)).toEqual(["Gf"]);
    expect(new Set(FULL_BLUEPRINT.sections.map((s) => s.domain))).toEqual(new Set(["Gf", "Gv", "Gq", "Gwm", "Gs", "Gc"]));
  });

  it("every practice item and span trial referenced by a blueprint exists in the bank", () => {
    for (const bp of [QUICK_BLUEPRINT, FULL_BLUEPRINT]) {
      for (const s of bp.sections) {
        for (const id of s.practiceItemIds) expect(bank.get(id).practice, id).toBe(true);
        if (s.kind === "speed") for (const b of s.blocks) for (const id of b.practiceItemIds) expect(bank.has(id), id).toBe(true);
        if (s.kind === "cat") {
          expect(Object.keys(s.contentTargets).sort()).toEqual([...s.families].sort());
          expect(bank.pool(s.families).length).toBeGreaterThan(s.stopping.maxItems);
        }
      }
    }
  });
});

describe("adaptive administration", () => {
  it("a quick session runs to completion within the blueprint's limits", () => {
    const ctx = ctxAt();
    const done = runHeadless(newSession("quick", ctx), simulee(0.5), ctx);
    expect(done.completedAt).not.toBeNull();
    const gf = done.sections[0] as CatSectionState;
    const { minItems, maxItems } = QUICK_BLUEPRINT.sections[0].kind === "cat" ? QUICK_BLUEPRINT.sections[0].stopping : { minItems: 0, maxItems: 0 };
    expect(gf.responses.length).toBeGreaterThanOrEqual(minItems);
    expect(gf.responses.length).toBeLessThanOrEqual(maxItems);
    expect(gf.stopReason).not.toBeNull();
    expect(new Set(gf.responses.map((r) => r.itemId)).size).toBe(gf.responses.length);
  });

  it("starts with a medium-difficulty item", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const ctx = ctxAt();
      let s = beginSection(newSession("quick", ctx, seed), ctx);
      const v = currentView(s, ctx);
      expect(v.type).toBe("practice");
      for (const id of QUICK_BLUEPRINT.sections[0].practiceItemIds) s = submitPractice(s, { itemId: id, response: null, rtMs: 1000 }, ctx);
      const first = currentView(s, ctx);
      if (first.type !== "item") throw new Error("expected an item");
      expect(Math.abs(first.item.difficulty.logit), `seed ${seed}`).toBeLessThanOrEqual(0.75);
    }
  });

  it("raises the ability estimate after correct answers and lowers it after errors", () => {
    const ctx = ctxAt();
    const done = runHeadless(newSession("full", ctx), simulee(0), ctx);
    for (const sec of done.sections) {
      if (sec.kind === "speed") continue;
      for (const r of sec.responses) {
        if (r.correct) expect(r.thetaAfter, r.itemId).toBeGreaterThan(r.thetaBefore);
        else expect(r.thetaAfter, r.itemId).toBeLessThan(r.thetaBefore);
      }
    }
  });

  it("serves harder items to stronger simulees and easier items to weaker ones", () => {
    const meanLogit = (theta: number) => {
      const vals: number[] = [];
      for (let seed = 1; seed <= 15; seed++) {
        const ctx = ctxAt();
        const done = runHeadless(newSession("quick", ctx, seed), simulee(theta, seed), ctx);
        const gf = done.sections[0] as CatSectionState;
        vals.push(...gf.responses.slice(-6).map((r) => r.params.b));
      }
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };
    const low = meanLogit(-1.5);
    const mid = meanLogit(0);
    const high = meanLogit(1.5);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });

  it("a full session covers every section and reaches a coherent end state", () => {
    const ctx = ctxAt();
    const done = runHeadless(newSession("full", ctx), simulee(0.3), ctx);
    expect(done.completedAt).not.toBeNull();
    expect(done.sections.every((s) => s.status === "complete")).toBe(true);
    const speed = done.sections.find((s) => s.kind === "speed");
    expect(speed && speed.kind === "speed" && speed.blocks.length).toBe(2);
  });

  it("span tasks stop after both trials at one length are failed", () => {
    const ctx = ctxAt();
    const failing: Simulee = { ...simulee(-10), rng: new Rng(3) };
    const done = runHeadless(newSession("full", ctx), failing, ctx);
    for (const sec of done.sections.filter((s): s is SpanSectionState => s.kind === "span")) {
      expect(sec.stopReason).toBe("discontinued");
      expect(sec.responses.length).toBe(2);
      expect(sec.responses.every((r) => !r.correct)).toBe(true);
    }
  });

  it("span tasks continue to the maximum length for a perfect respondent", () => {
    const ctx = ctxAt();
    const perfect: Simulee = { ...simulee(50), rng: new Rng(4) };
    const done = runHeadless(newSession("full", ctx), perfect, ctx);
    for (const sec of done.sections.filter((s): s is SpanSectionState => s.kind === "span")) {
      expect(["max-length", "time-limit"]).toContain(sec.stopReason);
    }
  });

  it("is deterministic: the same seed and answers give the same items", () => {
    const run = () => {
      const ctx = ctxAt();
      return runHeadless(newSession("full", ctx, 7), simulee(0.2, 99), ctx);
    };
    const a = run();
    const b = run();
    const ids = (s: Session) => s.sections.flatMap((sec) => (sec.kind === "speed" ? [] : sec.responses.map((r) => r.itemId)));
    expect(ids(a)).toEqual(ids(b));
  });
});

describe("response recording", () => {
  function atFirstItem(ctx: EngineContext) {
    let s = beginSection(newSession("quick", ctx), ctx);
    for (const id of QUICK_BLUEPRINT.sections[0].practiceItemIds) s = submitPractice(s, { itemId: id, response: null, rtMs: 1000 }, ctx);
    return s;
  }

  it("scores time-outs as incorrect and stores no response", () => {
    const ctx = ctxAt();
    let s = atFirstItem(ctx);
    const v = currentView(s, ctx);
    if (v.type !== "item" || v.item.response.kind !== "choice") throw new Error("expected a choice item");
    s = submitItem(s, { itemId: v.item.id, response: { kind: "choice", optionId: v.item.response.correctOptionId }, rtMs: 150_000, timedOut: true }, ctx);
    const r = (s.sections[0] as CatSectionState).responses[0];
    expect(r.timedOut).toBe(true);
    expect(r.correct).toBe(false);
    expect(r.response).toBeNull();
  });

  it("flags responses faster than a plausible solution time", () => {
    const ctx = ctxAt();
    let s = atFirstItem(ctx);
    const v = currentView(s, ctx);
    if (v.type !== "item") throw new Error("expected item");
    s = submitItem(s, { itemId: v.item.id, response: null, rtMs: rapidThresholdMs(v.item) - 1, timedOut: false }, ctx);
    expect((s.sections[0] as CatSectionState).responses[0].flags).toContain("rapid");
  });

  it("records presentation time, response time, option order and parameter provenance", () => {
    const ctx = ctxAt();
    let s = atFirstItem(ctx);
    const v = currentView(s, ctx);
    if (v.type !== "item") throw new Error("expected item");
    s = markPresented(s, 12345);
    s = submitItem(s, { itemId: v.item.id, response: simulateResponse(v.item, simulee(0)).response, rtMs: 23456.7, timedOut: false }, ctx);
    const r = (s.sections[0] as CatSectionState).responses[0];
    expect(r.presentedAt).toBe(12345);
    expect(r.rtMs).toBe(23457);
    expect(r.paramStatus).toBe("provisional");
    expect(r.paramSource).toBe("provisional-1PL-G");
    if (v.item.response.kind === "choice") expect([...r.optionOrder!].sort()).toEqual(v.item.response.options.map((o) => o.id).sort());
  });

  it("re-scores speed trials on the engine side", () => {
    const ctx = ctxAt();
    let s = newSession("full", ctx);
    // jump to the speed section
    s = { ...s, sectionIndex: 4, sections: s.sections.map((sec, i) => (i < 4 ? { ...sec, status: "complete" } : i === 4 ? { ...sec, status: "intro" } : sec)) as Session["sections"] };
    s = beginSection(s, ctx);
    s = submitBaseline(s, [{ foreperiodMs: 1000, rtMs: 300, anticipation: false }], ctx);
    const v = currentView(s, ctx);
    if (v.type !== "speed-block") throw new Error("expected speed block");
    const item = v.trials[0];
    const correctValue = (item.response as { correct: 0 | 1 }).correct;
    s = submitSpeedBlock(
      s,
      {
        task: v.block.task,
        durationMs: 60000,
        trials: [{ itemId: item.id, response: correctValue, correct: false, rtMs: 900 }],
        practice: [],
        frameIntervalMs: 16.7,
        inputModality: "keyboard",
        interrupted: false,
      },
      ctx,
    );
    const sec = s.sections[4];
    expect(sec.kind === "speed" && sec.blocks[0].trials[0].correct).toBe(true);
  });

  it("ending early keeps completed work and marks the rest skipped", () => {
    const ctx = ctxAt();
    const s = endEarly(beginSection(newSession("full", ctx), ctx), ctx);
    expect(s.completedAt).not.toBeNull();
    expect(s.endedEarly).toBe(true);
    expect(s.sections.every((sec) => sec.status === "skipped")).toBe(true);
    expect(currentView(s, ctx).type).toBe("complete");
  });
});

describe("session recovery", () => {
  it("a session saved mid-test and reloaded continues exactly as an uninterrupted one", async () => {
    const repo = new LocalSessionRepository(new MemoryStorage());
    const sim = () => simulee(0.4, 5);
    // Uninterrupted reference run.
    const ctxA = ctxAt();
    const reference = runHeadless(newSession("full", ctxA, 11), sim(), ctxA);

    // Interrupted run: stop after 9 actions, persist, reload, continue.
    const ctxB = ctxAt();
    const s0 = newSession("full", ctxB, 11);
    const simB = sim();
    let s = s0;
    for (let i = 0; i < 9; i++) {
      const v = currentView(s, ctxB);
      if (v.type === "section-intro") s = beginSection(s, ctxB);
      else if (v.type === "practice") s = submitPractice(s, { itemId: v.item.id, response: simulateResponse(v.item, simB).response, rtMs: 5000 }, ctxB);
      else if (v.type === "item" || v.type === "span-trial") {
        const { response } = simulateResponse(v.item, simB);
        s = submitItem(s, { itemId: v.item.id, response, rtMs: Math.round(v.item.estimatedTimeSec * 1000 * (0.6 + 0.8 * simB.rng.next())), timedOut: false }, ctxB);
      }
    }
    await repo.save(s);
    const loaded = await repo.load(s.id);
    expect(loaded).toEqual(s);
    const resumed = resumeSession(loaded!, ctxB);
    const finished = runHeadless(resumed, simB, ctxB);
    const ids = (x: Session) => x.sections.flatMap((sec) => (sec.kind === "speed" ? [] : sec.responses.map((r) => r.itemId)));
    expect(ids(finished)).toEqual(ids(reference));
    expect(finished.events.some((e) => e.type === "resumed")).toBe(true);
  });

  it("an item interrupted mid-response resumes with its elapsed time and is flagged", async () => {
    const repo = new LocalSessionRepository(new MemoryStorage());
    const ctx = ctxAt();
    let s = beginSection(newSession("quick", ctx), ctx);
    for (const id of QUICK_BLUEPRINT.sections[0].practiceItemIds) s = submitPractice(s, { itemId: id, response: null, rtMs: 1000 }, ctx);
    s = markPresented(s, ctx.now());
    s = heartbeat(s, 30_000);
    await repo.save(s);
    const reloaded = resumeSession((await repo.load(s.id))!, ctx);
    const v = currentView(reloaded, ctx);
    if (v.type !== "item") throw new Error("expected item");
    expect(v.current.elapsedMs).toBe(30_000);
    expect(v.current.resumed).toBe(true);
    const after = submitItem(reloaded, { itemId: v.item.id, response: null, rtMs: 45_000, timedOut: false }, ctx);
    const r = (after.sections[0] as CatSectionState).responses[0];
    expect(r.resumed).toBe(true);
    expect(r.rtMs).toBe(45_000);
  });

  it("the repository lists, activates, removes and bounds stored sessions", async () => {
    const repo = new LocalSessionRepository(new MemoryStorage());
    const ctx = ctxAt();
    for (let i = 0; i < 30; i++) {
      ctx.advance(1000);
      const done = endEarly(newSession("quick", ctx, i), ctx);
      await repo.save({ ...done, id: `s${i}` });
    }
    const list = await repo.list();
    expect(list.length).toBe(25);
    expect(list[0].id).toBe("s29");
    await repo.setActiveId("s29");
    expect(await repo.getActiveId()).toBe("s29");
    await repo.remove("s29");
    expect(await repo.getActiveId()).toBeNull();
    expect(await repo.load("s29")).toBeNull();
    await repo.clearAll();
    expect(await repo.list()).toEqual([]);
  });

  it("rejects unreadable or foreign data instead of crashing", async () => {
    expect(migrateSession(null)).toBeNull();
    expect(migrateSession({ schemaVersion: 99 })).toBeNull();
    expect(migrateSession({ schemaVersion: 1, id: 3 })).toBeNull();
    const storage = new MemoryStorage();
    storage.setItem("iqa:v1:session:bad", "{not json");
    expect(await new LocalSessionRepository(storage).load("bad")).toBeNull();
  });
});

describe("response timer", () => {
  it("measures active time and excludes time while paused", () => {
    let t = 100;
    const timer = new ResponseTimer(() => t);
    timer.start();
    t = 600;
    timer.pause();
    t = 1600;
    timer.resume();
    t = 2100;
    expect(timer.stop()).toEqual({ activeMs: 1000, hiddenMs: 1000, pauses: 1 });
  });

  it("continues from time already spent before an interruption", () => {
    let t = 0;
    const timer = new ResponseTimer(() => t, 30_000);
    expect(timer.elapsed()).toBe(30_000);
    timer.start();
    t = 5000;
    expect(timer.elapsed()).toBe(35_000);
  });

  it("stopping while paused does not count the paused interval", () => {
    let t = 0;
    const timer = new ResponseTimer(() => t);
    timer.start();
    t = 400;
    timer.pause();
    t = 10_000;
    expect(timer.stop().activeMs).toBe(400);
  });
});
