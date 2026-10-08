/**
 * Regenerate tests/e2e/fixtures/full-session.json: a completed full-mode
 * session produced by a SIMULATED respondent, used to test the results page.
 *
 *   npx tsx scripts/make-e2e-fixture.ts
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import bankJson from "../src/data/item-bank.json";
import { createSession, ItemBankIndex } from "../src/lib/assessment/engine";
import { DEFAULT_SETTINGS } from "../src/lib/assessment/session";
import type { ItemBank } from "../src/lib/items/types";
import { ParameterResolver } from "../src/lib/psychometrics/parameters";
import { Rng } from "../src/lib/random";
import { runHeadless } from "../src/lib/simulation/respondent";

let t = Date.UTC(2026, 0, 15, 9, 0, 0);
const ctx = { bank: new ItemBankIndex(bankJson as unknown as ItemBank), resolver: new ParameterResolver(), now: () => (t += 1500) };
const session = createSession(
  {
    id: "e2e-simulated-full",
    mode: "full",
    seed: 5,
    participant: { ageYears: 34, englishFirstLanguage: "no", researchConsent: true },
    settings: DEFAULT_SETTINGS,
    environment: { userAgent: "simulated", screenWidth: 1280, screenHeight: 800, devicePixelRatio: 1, primaryPointer: "fine" },
  },
  ctx,
);
const done = runHeadless(session, { theta: { Gf: 0.9, Gv: 0.2, Gq: 1.1, Gwm: 0.4, Gs: 0.3, Gc: -0.2 }, model: { kind: "provisional" }, rng: new Rng(12) }, ctx);
writeFileSync(resolve(__dirname, "../tests/e2e/fixtures/full-session.json"), JSON.stringify(done) + "\n");
console.log(`Wrote ${done.id}`);
