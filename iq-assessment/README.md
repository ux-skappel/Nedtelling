# Tanke — an open, adaptive cognitive assessment (research preview)

Tanke is a browser-based cognitive ability assessment built on the
Cattell–Horn–Carroll (CHC) model of intelligence and item response theory
(IRT). It contains an original bank of 524 items, an adaptive testing engine,
and a results dashboard that reports **provisional** results with honest
uncertainty.

> **It is not (yet) an IQ test.** An IQ is a norm-referenced score and this
> test has no norm sample, and its items have not been calibrated on real
> participants. The app therefore never shows an IQ, a percentile or any
> comparison with other people. The code to compute validated IQ scores
> exists, but it is locked until real normative data are added. See
> [docs/METHODOLOGY.md](docs/METHODOLOGY.md).

## What is in here

| | |
|---|---|
| **Two modes** | Quick (15–20 min, fluid reasoning only) and Full (45–60 min, six abilities in nine sections) |
| **Item bank** | 524 original items: 245 adaptive reasoning/knowledge items, 56 working-memory trials, 192 speed trials, 24 practice items — every key independently verified |
| **Adaptive engine** | Maximum-information item selection, content balancing, exposure control, EAP ability estimation, stopping rules |
| **Scoring** | Provisional development scoring today; a guarded, norm-referenced pipeline ready for real norms |
| **Results** | Ability profile with 95% intervals, domain details, measurement trajectory, response-quality checks, answer review |
| **Privacy** | Everything stays in the participant's browser (local storage); nothing is uploaded |

## Run it on your computer

You need [Node.js](https://nodejs.org) 20.9 or newer (22 recommended).

```bash
cd iq-assessment
npm install          # install dependencies (once)
npm run dev          # start the development server
```

Then open <http://localhost:3000> in your browser.

To try the production build locally:

```bash
npm run build
npm run start        # serves on http://localhost:3000
```

## Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` / `npm run start` | Production build / serve it |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript type check |
| `npm test` | Unit, integration and component tests (Vitest, ~100 tests) |
| `npm run test:e2e` | End-to-end tests in a real browser (Playwright; builds the app first) |
| `npm run verify` | lint + typecheck + bank check + unit tests — run before every commit |
| `npm run bank:generate` | Regenerate the frozen item bank `src/data/item-bank.json` |
| `npm run bank:check` | Fail if the generators no longer reproduce the frozen bank |
| `npm run simulate` | Run the Monte Carlo study and rewrite `docs/SIMULATION_REPORT.md` |

End-to-end tests need a Chromium browser: run `npx playwright install chromium`
once. To test against a server that is already running, set
`E2E_BASE_URL=http://localhost:3000`. The `@slow` full-mode test takes about
three minutes.

## Deploy to Vercel

This app lives in the `iq-assessment/` folder of a repository that also
contains another project, so Vercel must be told where it is.

1. Sign in at [vercel.com](https://vercel.com) and choose **Add New… → Project**.
2. Import the GitHub repository.
3. Under **Root Directory**, click **Edit** and choose `iq-assessment`.
   Vercel then detects **Next.js** automatically; keep the default build
   settings (`npm run build`, output handled by Next.js).
4. (Optional) Under **Environment Variables**, add
   `NEXT_PUBLIC_ENABLE_ITEM_REVIEW=true` **only on a private deployment** if
   reviewers need the `/review` page, which shows every answer key.
5. Click **Deploy**.

Every push to the branch then deploys automatically. The repository-root
`vercel.json` belongs to the other project and does not apply when the Root
Directory is `iq-assessment`.

With the Vercel CLI instead: `cd iq-assessment && npx vercel` (first time it
asks to link a project), then `npx vercel --prod`.

No database or secrets are needed: sessions are stored in the participant's
browser.

## Project structure

```
iq-assessment/
├── src/
│   ├── app/                     Next.js routes (App Router)
│   │   ├── (site)/              pages with the site header: home, start, results, history, methodology, review
│   │   └── test/                the assessment runner (distraction-free layout)
│   ├── components/
│   │   ├── stimuli/             SVG renderers for every item type
│   │   ├── assessment/          runner, item/span/speed screens, timers
│   │   ├── results/             dashboard, charts, domain cards, norm panel
│   │   └── ui/                  shadcn/ui components
│   ├── lib/
│   │   ├── psychometrics/       IRT, estimation, selection, stopping, parameter resolution
│   │   ├── items/               item types, generators, independent solvers, geometry
│   │   ├── assessment/          blueprints, session model, engine (state machine), persistence, timing
│   │   ├── scoring/             development scoring, profile analysis, validated (norm-referenced) scoring
│   │   ├── norms/               norm-table model, registry (empty), analysis tools (DIF, reliability, export)
│   │   └── simulation/          simulated respondents and the Monte Carlo study
│   └── data/                    frozen item bank and simulation summary (generated)
├── scripts/                     bank generation, simulation, test fixtures
├── tests/                       e2e tests (Playwright) and test fixtures
└── docs/                        methodology, architecture, item bank, validation roadmap, simulation report
```

## Documentation

- [docs/METHODOLOGY.md](docs/METHODOLOGY.md) — psychometric design, every assumption, scoring, limitations
- [docs/ITEM_BANK.md](docs/ITEM_BANK.md) — item families, rules, difficulty models, verification, versioning
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules, data flow, adding Supabase
- [docs/VALIDATION_ROADMAP.md](docs/VALIDATION_ROADMAP.md) — the path from provisional to validated scores
- [docs/SIMULATION_REPORT.md](docs/SIMULATION_REPORT.md) — generated simulation results

## Status and limitations (short version)

Every item is original and logically verified, and the adaptive engine and
scoring are fully implemented and tested. What is missing is **empirical
evidence**: item calibration, reliability, validity and norms all require
testing real people. Until then results are provisional, are not a diagnosis,
and must not be used for clinical, educational or employment decisions.
