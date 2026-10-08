"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, Info, ShieldCheck, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getRepository } from "@/lib/assessment/browser";
import type { Session } from "@/lib/assessment/session";
import { formatDate, formatDuration } from "@/lib/format";
import { LEVEL_LABELS, levelFromLogit } from "@/lib/items/difficulty";
import { DOMAIN_LABELS } from "@/lib/items/types";
import { ACTIVE_CALIBRATION, ACTIVE_NORM_TABLE } from "@/lib/norms/registry";
import { scoreSession } from "@/lib/scoring/development";
import { checkNormEligibility, normReferencedScores } from "@/lib/scoring/validated";
import { AnswerReview } from "./answer-review";
import { ProfileChart, TrajectoryChart } from "./charts";
import { DomainCard } from "./domain-card";
import { NormPanel } from "./norm-panel";
import { WhatIqMeasures } from "./what-iq-measures";

function Section({ id, eyebrow, title, children, intro }: { id: string; eyebrow?: string; title: string; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-16">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h2 id={id} className="mt-1.5 text-xl font-semibold sm:text-2xl">
        {title}
      </h2>
      {intro && <div className="mt-3 max-w-2xl text-[0.95rem] leading-7 text-muted-foreground">{intro}</div>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function StatTile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4 sm:p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function download(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function ResultsView({ id }: { id: string }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [table, setTable] = useState(false);

  useEffect(() => {
    getRepository()
      .load(id)
      .then((s) => setSession(s));
  }, [id]);

  const report = useMemo(() => (session ? scoreSession(session) : null), [session]);
  const eligibility = useMemo(
    () => (session && report ? checkNormEligibility(session, report, ACTIVE_NORM_TABLE, ACTIVE_CALIBRATION) : null),
    [session, report],
  );
  const normReport = useMemo(
    () => (session && report && eligibility?.eligible ? normReferencedScores(session, report, ACTIVE_NORM_TABLE, ACTIVE_CALIBRATION) : null),
    [session, report, eligibility],
  );

  if (session === undefined) return <p className="mx-auto max-w-5xl px-5 py-24 text-muted-foreground sm:px-8">Loading results…</p>;
  if (session === null || !report || !eligibility)
    return (
      <div className="mx-auto max-w-2xl px-5 py-24 sm:px-8">
        <h1 className="text-2xl font-semibold">Results not found on this device</h1>
        <p className="mt-3 text-muted-foreground">Results are stored only in the browser where the assessment was taken.</p>
        <Button asChild className="mt-6">
          <Link href="/history">See results stored here</Link>
        </Button>
      </div>
    );

  const irt = report.domains.filter((d) => d.scoring === "irt" && d.theta !== null);
  const trajectoryDomains = irt.filter((d) => d.trajectory.length > 1);
  const ValidityIcon = report.validity.level === "ok" ? ShieldCheck : AlertTriangle;
  const gf = report.domains.find((d) => d.domain === "Gf");

  return (
    <div className="mx-auto max-w-5xl px-5 pt-12 pb-8 sm:px-8 sm:pt-16">
      <header>
        <p className="eyebrow">{formatDate(report.startedAt)}</p>
        <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Your results</h1>
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge variant="outline">{session.mode === "quick" ? "Quick assessment" : "Full assessment"}</Badge>
          <Badge className="border-notice-border bg-notice text-notice-foreground">Provisional</Badge>
          <Badge variant="outline">Not norm-referenced</Badge>
          {report.endedEarly && <Badge variant="outline">Ended early</Badge>}
          {session.settings.extendedTime && <Badge variant="outline">Extended time</Badge>}
        </div>
      </header>

      <div className="mt-8 rounded-xl border border-notice-border bg-notice p-5 text-notice-foreground sm:p-6" role="note">
        <div className="flex gap-3">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="space-y-2 text-[0.95rem] leading-7">
            <p className="font-semibold">These are provisional results, not an IQ score.</p>
            <p>
              They show how far up this test&apos;s difficulty scale you reliably got in each area, with the uncertainty of
              each estimate. The questions have not yet been calibrated on real participants and the test has no norm
              sample, so the results cannot say how you compare with other people — and are not a diagnosis.
            </p>
          </div>
        </div>
      </div>

      <section aria-label="Summary" className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Time taken" value={formatDuration(report.totalDurationMs)} sub={`${formatDuration(report.activeTestingMs)} on questions`} />
        <StatTile label="Questions answered" value={report.overall.itemsAnswered} sub={session.mode === "full" ? "plus timed speed tasks" : undefined} />
        <StatTile label="Areas measured" value={`${report.overall.domainsMeasured} of ${report.domains.length}`} />
        <StatTile
          label="Response quality"
          value={
            <span className="inline-flex items-center gap-2 text-xl">
              <ValidityIcon className="size-5" aria-hidden />
              {report.validity.level === "ok" ? "No concerns" : report.validity.level === "caution" ? "Some concerns" : "Questionable"}
            </span>
          }
          sub="Guessing, interruptions, time-outs"
        />
      </section>

      {session.mode === "quick" && gf?.level && (
        <Section
          id="headline"
          eyebrow="Fluid reasoning"
          title={`Provisional level ${gf.level.estimate} of 5 · ${LEVEL_LABELS[gf.level.estimate]}`}
          intro={
            <>
              Your estimate falls in the band of level-{gf.level.estimate} questions — the difficulty you would be expected to
              solve about half the time. Given the length of the quick assessment, the 95% range spans level {gf.level.low}
              {gf.level.high !== gf.level.low ? ` to ${gf.level.high}` : ""}. The full assessment measures more precisely and
              covers six areas.
            </>
          }
        >
          {null}
        </Section>
      )}

      {irt.length > 0 && (
        <Section
          id="profile"
          eyebrow="Profile"
          title={session.mode === "quick" ? "Where your estimate sits" : "Your provisional ability profile"}
          intro={
            <>
              Each estimate is placed on this test&apos;s own difficulty scale (levels 1–5). The line around each dot is the
              95% interval: the narrower it is, the more precise the estimate. Processing speed is reported separately,
              as a rate.
            </>
          }
        >
          <div className="rounded-xl border bg-card p-4 sm:p-6">
            <div className="mb-2 flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setTable(!table)} aria-pressed={table}>
                {table ? "Show chart" : "Show as table"}
              </Button>
            </div>
            {table ? (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-2 font-medium">Area</th>
                    <th className="pb-2 font-medium">Provisional level</th>
                    <th className="pb-2 font-medium">95% range</th>
                    <th className="pb-2 font-medium">Estimate (logit) ± SE</th>
                  </tr>
                </thead>
                <tbody>
                  {irt.map((d) => (
                    <tr key={d.domain} className="border-t">
                      <td className="py-2">{d.label}</td>
                      <td className="py-2 tabular-nums">{d.level!.estimate}</td>
                      <td className="py-2 tabular-nums">
                        {d.level!.low}–{d.level!.high}
                      </td>
                      <td className="py-2 tabular-nums">
                        {d.theta!.toFixed(2)} ± {d.se!.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <ProfileChart domains={irt} />
            )}
          </div>
        </Section>
      )}

      <Section id="domains" eyebrow="Details" title={session.mode === "quick" ? "Details" : "Area by area"}>
        <div className="grid gap-4 md:grid-cols-2">
          {[...report.domains]
            .sort((a, b) => Number(a.domain === "Gwm" || a.domain === "Gs") - Number(b.domain === "Gwm" || b.domain === "Gs"))
            .map((d) => (
            <div key={d.domain} className={d.domain === "Gs" || d.domain === "Gwm" ? "min-w-0 md:col-span-2" : "min-w-0"}>
              <DomainCard d={d} />
            </div>
          ))}
        </div>
        <p className="mt-4 max-w-2xl text-xs leading-5 text-muted-foreground">
          In an adaptive test, the percentage correct is not a measure of ability: questions get harder when you answer
          correctly and easier when you do not, so most people answer a similar share correctly. The level is what carries
          the information.
        </p>
      </Section>

      {report.profile && (
        <Section
          id="strengths"
          eyebrow="Strengths and weaknesses"
          title="Relative strengths and weaknesses"
          intro="An area is called a relative strength or weakness only if it differs from your own average by more than the measurement error allows. With short sections that is rare — most differences you see are within the noise."
        >
          <ul className="grid gap-3 sm:grid-cols-2">
            {report.profile.map((p) => (
              <li key={p.domain} className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 text-sm">
                <span>{DOMAIN_LABELS[p.domain]}</span>
                <span className={p.classification === "no-reliable-difference" ? "text-muted-foreground" : "font-medium"}>
                  {p.classification === "relative-strength"
                    ? "Relative strength"
                    : p.classification === "relative-weakness"
                      ? "Relative weakness"
                      : "Within your usual range"}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 max-w-2xl text-xs leading-5 text-muted-foreground">
            Tentative: comparing areas assumes their difficulty scales are equivalent, which has not yet been verified with
            data.
          </p>
        </Section>
      )}

      {trajectoryDomains.length > 0 && (
        <Section
          id="trajectory"
          eyebrow="Measurement"
          title="How each estimate developed"
          intro="After every answer the estimate is updated and its uncertainty shrinks. Questions were chosen to be informative at your current estimate — that is why they cluster around it."
        >
          <div className="rounded-xl border bg-card p-4 sm:p-6">
            <Tabs defaultValue={trajectoryDomains[0].domain}>
              {trajectoryDomains.length > 1 && (
                <TabsList className="mb-4 flex h-auto flex-wrap">
                  {trajectoryDomains.map((d) => (
                    <TabsTrigger key={d.domain} value={d.domain} className="text-muted-foreground data-[state=active]:text-foreground">
                      {d.label.replace(" (crystallised)", "")}
                    </TabsTrigger>
                  ))}
                </TabsList>
              )}
              {trajectoryDomains.map((d) => (
                <TabsContent key={d.domain} value={d.domain}>
                  <TrajectoryChart domain={d} />
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer text-muted-foreground">Data table</summary>
                    <table className="mt-2 w-full text-xs">
                      <thead className="text-left text-muted-foreground">
                        <tr>
                          <th className="py-1 font-medium">Question</th>
                          <th className="py-1 font-medium">Difficulty level</th>
                          <th className="py-1 font-medium">Result</th>
                          <th className="py-1 font-medium">Estimate after (logit ± SE)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.trajectory.map((t) => (
                          <tr key={t.index} className="border-t">
                            <td className="py-1 tabular-nums">{t.index}</td>
                            <td className="py-1 tabular-nums">{levelFromLogit(t.b)}</td>
                            <td className="py-1">{t.correct ? "Correct" : "Incorrect"}</td>
                            <td className="py-1 tabular-nums">
                              {t.theta.toFixed(2)} ± {t.se.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </TabsContent>
              ))}
            </Tabs>
          </div>
        </Section>
      )}

      <Section
        id="norms"
        eyebrow="IQ and percentiles"
        title="Norm-referenced scores"
        intro={
          <>
            IQ scores use the formula IQ = 100 + 15 × z, where z is your ability estimate standardised against people of
            your age in a representative norm sample. Without such a sample, there is no honest z — so no IQ.
          </>
        }
      >
        <NormPanel eligibility={eligibility} report={normReport} />
      </Section>

      <Section id="validity" eyebrow="Response quality" title="How the assessment went">
        <div className="rounded-xl border bg-card p-5 sm:p-6">
          {report.validity.warnings.length === 0 ? (
            <p className="flex items-center gap-2 text-sm">
              <ShieldCheck className="size-4" aria-hidden /> No signs of rapid guessing, interruptions or time pressure were
              detected.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {report.validity.warnings.map((w) => (
                <li key={w} className="flex gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {w}
                </li>
              ))}
            </ul>
          )}
          <dl className="mt-5 grid grid-cols-2 gap-4 border-t pt-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Very fast answers</dt>
              <dd className="mt-0.5 font-medium tabular-nums">{report.validity.rapidResponses}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Time-outs</dt>
              <dd className="mt-0.5 font-medium tabular-nums">{report.validity.timeouts}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Times the window was left</dt>
              <dd className="mt-0.5 font-medium tabular-nums">{report.validity.hiddenEvents}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Interrupted questions</dt>
              <dd className="mt-0.5 font-medium tabular-nums">{report.validity.resumedItems}</dd>
            </div>
          </dl>
        </div>
      </Section>

      <Section id="iq" eyebrow="Context" title="What IQ tests measure — and what they don't">
        <WhatIqMeasures />
      </Section>

      <Section id="review" eyebrow="Review" title="Questions and answers">
        <AnswerReview session={session} />
      </Section>

      <section className="mt-16 flex flex-wrap gap-3 border-t pt-8" aria-label="Actions">
        <Button asChild>
          <Link href="/">Back to the start</Link>
        </Button>
        <Button variant="outline" onClick={() => download(`tanke-${session.id}.json`, { session, report })}>
          <Download aria-hidden /> Download my data
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" className="text-muted-foreground">
              <Trash2 aria-hidden /> Delete these results
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete these results?</AlertDialogTitle>
              <AlertDialogDescription>They are stored only on this device, so this cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  await getRepository().remove(session.id);
                  router.push("/history");
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
      <p className="mt-6 text-xs text-muted-foreground">
        Item bank {report.bankVersion} · item parameters {report.parameterStatus} ·{" "}
        <Link href="/methodology" className="underline underline-offset-4">
          how these results are computed
        </Link>
      </p>
    </div>
  );
}
