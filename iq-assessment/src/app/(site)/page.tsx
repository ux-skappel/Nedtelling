import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResumeBanner } from "@/components/assessment/resume-banner";
import { FULL_BLUEPRINT, QUICK_BLUEPRINT } from "@/lib/assessment/blueprint";

const DOMAINS = [
  { code: "Gf", name: "Fluid reasoning", text: "Solving novel problems: matrices, figure series and deduction." },
  { code: "Gv", name: "Visual-spatial", text: "Mental rotation of shapes and objects, paper folding." },
  { code: "Gq", name: "Quantitative", text: "Number series, number grids and balance puzzles." },
  { code: "Gwm", name: "Working memory", text: "Holding and reordering sequences of digits, letters and locations." },
  { code: "Gs", name: "Processing speed", text: "Fast, accurate visual comparisons." },
  { code: "Gc", name: "Verbal knowledge", text: "Vocabulary, analogies and concepts (English)." },
];

function ModeCard({ mode }: { mode: "quick" | "full" }) {
  const bp = mode === "quick" ? QUICK_BLUEPRINT : FULL_BLUEPRINT;
  return (
    <div className="flex flex-col rounded-xl border bg-card p-6 sm:p-7">
      <p className="eyebrow">
        {bp.estimatedMinutes[0]}–{bp.estimatedMinutes[1]} minutes
      </p>
      <h3 className="mt-2 text-xl font-semibold">{bp.title}</h3>
      <p className="mt-3 flex-1 text-[0.95rem] leading-6 text-muted-foreground">{bp.description}</p>
      <ul className="mt-5 space-y-1.5 text-sm">
        {mode === "quick" ? (
          <>
            <li>One adaptive fluid-reasoning section</li>
            <li>A single provisional estimate with its uncertainty</li>
            <li>Lower precision — a first impression only</li>
          </>
        ) : (
          <>
            <li>Nine sections across six ability domains</li>
            <li>A provisional domain profile with uncertainty</li>
            <li>Short breaks between sections</li>
          </>
        )}
      </ul>
      <Button asChild size="lg" className="mt-7 h-11 w-full justify-between px-4 text-[0.95rem]" variant={mode === "full" ? "default" : "outline"}>
        <Link href={`/start/${mode}`}>
          Start the {mode} assessment
          <ArrowRight aria-hidden />
        </Link>
      </Button>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="mx-auto max-w-5xl px-5 sm:px-8">
      <ResumeBanner />
      <section className="pt-16 pb-14 sm:pt-24">
        <p className="eyebrow">Research preview</p>
        <h1 className="mt-4 max-w-3xl text-4xl leading-[1.1] font-semibold sm:text-5xl">
          A careful, transparent measure of how you reason.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
          An adaptive cognitive assessment grounded in the Cattell–Horn–Carroll model of intelligence and item response
          theory. Every question is original. Every score comes with its uncertainty — and with an honest account of
          what it can and cannot tell you.
        </p>
      </section>

      <section aria-labelledby="modes" className="grid gap-5 md:grid-cols-2">
        <h2 id="modes" className="sr-only">
          Choose an assessment
        </h2>
        <ModeCard mode="quick" />
        <ModeCard mode="full" />
      </section>

      <section className="mt-20 grid gap-10 md:grid-cols-[1fr_2fr]" aria-labelledby="honest">
        <div>
          <p className="eyebrow">Before you begin</p>
          <h2 id="honest" className="mt-2 text-2xl font-semibold">
            This is not (yet) an IQ test
          </h2>
        </div>
        <div className="prose-quiet">
          <p>
            An IQ score says where you stand relative to a reference population. That requires testing a large,
            representative sample of people with the same items — a norming study — and this test has not had one. Its
            items have not yet been calibrated on real participants either.
          </p>
          <p>
            So instead of an IQ, you will receive <strong>provisional results</strong>: how far up the difficulty ladder
            you reliably got in each area, with honest error bars, plus raw measures such as memory span and items per
            minute. No percentiles, no comparisons with other people, no labels. The{" "}
            <Link href="/methodology">methodology page</Link> explains exactly how scores are computed and what would be
            needed to turn them into validated IQ scores.
          </p>
          <p>
            The results are not a diagnosis and must not be used for clinical, educational or employment decisions.
          </p>
        </div>
      </section>

      <section className="mt-20" aria-labelledby="domains">
        <p className="eyebrow">What the full assessment covers</p>
        <h2 id="domains" className="mt-2 text-2xl font-semibold">
          Six broad abilities
        </h2>
        <dl className="mt-8 grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {DOMAINS.map((d) => (
            <div key={d.code} className="bg-card p-5">
              <dt className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-muted-foreground">{d.code}</span>
                <span className="font-medium">{d.name}</span>
              </dt>
              <dd className="mt-1.5 text-sm leading-6 text-muted-foreground">{d.text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-20 grid gap-8 sm:grid-cols-3" aria-label="Practical information">
        {[
          ["Private by default", "Your answers are stored only in this browser. Nothing is sent to a server."],
          ["Built for focus", "One question per screen, keyboard shortcuts, and settings for larger text and high contrast."],
          ["Pause and resume", "Progress is saved after every answer. Close the tab and continue later."],
        ].map(([t, d]) => (
          <div key={t}>
            <h3 className="font-medium">{t}</h3>
            <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
