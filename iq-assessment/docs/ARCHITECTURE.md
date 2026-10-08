# Architecture

## Principles

1. **The science is plain TypeScript.** Item generation, IRT, adaptive
   selection, scoring and norming live in `src/lib` with no React, DOM or
   storage dependencies. They run identically in the browser, in Node scripts
   (bank generation, simulation) and in tests.
2. **The engine is a pure state machine.** The UI asks the engine what to show
   (`currentView`) and reports what happened (`submitItem`, `submitBaseline`,
   …). Every action returns a new JSON-serialisable `Session`, which is
   persisted after every change. The random generator's state is part of the
   session, so a reloaded session continues with exactly the item selection it
   would otherwise have had.
3. **Provisional and validated are separate code paths.** Parameter
   resolution (`psychometrics/parameters.ts`) and norm-referenced scoring
   (`scoring/validated.ts`) refuse to mix provisional and empirical inputs.

## Modules

| Path | Responsibility |
|---|---|
| `lib/psychometrics/` | IRT response and information functions, EAP/MLE, selection, stopping, parameter resolution, statistics |
| `lib/items/` | Item model, figure vocabulary, geometry, generators, independent solvers, bank loader |
| `lib/assessment/` | Blueprints (quick/full), session model, engine, repository, timing, browser wiring |
| `lib/scoring/` | Development scoring, within-person profile, validated scoring |
| `lib/norms/` | Norm-table model and validation, active registry (empty), pilot-analysis tools (reliability, item analysis, Mantel–Haenszel DIF, long-format export) |
| `lib/simulation/` | Simulated respondents (headless runner) and the Monte Carlo study |
| `components/stimuli/` | SVG renderers for all item types |
| `components/assessment/` | Runner and screens (items, spans, speed), timers |
| `components/results/` | Dashboard, Recharts charts, norm panel |
| `app/` | Routes: `/`, `/start/[mode]`, `/test`, `/results/[id]`, `/history`, `/methodology`, `/review` |

## Data flow

```
setup form ──createSession──▶ Session ──save──▶ SessionRepository (localStorage)
                                 │
runner ◀──currentView── engine ◀─┘   (bank index + parameter resolver + clock)
   │  submit…/markPresented/heartbeat/recordEvent
   ▼
engine ──▶ new Session ──save──▶ repository
   │ completed
   ▼
results ──scoreSession──▶ DevelopmentReport ──checkNormEligibility──▶ (locked) NormReferencedReport
```

## Persistence and adding Supabase

`SessionRepository` (`lib/assessment/repository.ts`) is asynchronous even
though the current implementation (`LocalSessionRepository`) uses
synchronous local storage. To add accounts and server storage:

1. Add `@supabase/supabase-js` and Supabase Auth (anonymous sign-in keeps
   today's no-account flow).
2. Implement `SupabaseSessionRepository` with the same interface. A simple
   schema:

   ```sql
   create table sessions (
     id uuid primary key,
     user_id uuid references auth.users not null default auth.uid(),
     mode text not null,
     bank_version text not null,
     created_at timestamptz not null,
     completed_at timestamptz,
     data jsonb not null            -- the Session object
   );
   alter table sessions enable row level security;
   create policy "own sessions" on sessions for all using (user_id = auth.uid());

   -- optional, for research exports of consenting participants
   create table responses (
     session_id uuid references sessions on delete cascade,
     item_id text, item_version int, correct boolean, rt_ms int,
     position int, presented_at timestamptz
   );
   ```
3. Swap the repository in `lib/assessment/browser.ts`.
4. For any higher-stakes use, move scoring server-side (an Edge Function that
   holds the answer keys) and stop shipping keys to the browser.

## Design system

- Warm white and charcoal, one typeface (Geist), generous whitespace.
- No dark theme by design: stimuli must look the same for everyone. High
  contrast, larger text and reduced motion are explicit settings.
- Stimuli use only achromatic colours, so no item depends on colour vision.
- Charts use two categorical colours (`--series-1` #2a78d6, `--series-2`
  #eb6834) validated for lightness, chroma, colour-vision-deficiency
  separation and contrast; every chart has a table view.

## Testing

| Layer | Tool | Location |
|---|---|---|
| Psychometrics, items, engine, scoring, simulation | Vitest | `src/lib/**/*.test.ts` |
| Components | Vitest + Testing Library (jsdom) | `src/components/**/*.test.tsx` |
| End-to-end, accessibility (axe), mobile | Playwright | `tests/e2e/` |
