import { Badge } from "@/components/ui/badge";
import { LEVEL_LABELS } from "@/lib/items/difficulty";
import type { DifficultyLevel } from "@/lib/items/types";
import { STOP_REASON_TEXT, type StopReason } from "@/lib/psychometrics/stopping";
import type { DomainResult } from "@/lib/scoring/development";
import { formatPercent, formatSeconds } from "@/lib/format";
import { cn } from "@/lib/utils";

const SPAN_STOP: Record<string, string> = {
  discontinued: "two sequences of the same length were missed",
  "max-length": "the longest sequence was reached",
  "time-limit": "the time limit was reached",
};

/** Five-step ladder: the shaded range is the 95% interval, the ring the estimate. */
export function LevelLadder({ estimate, low, high }: { estimate: DifficultyLevel; low: DifficultyLevel; high: DifficultyLevel }) {
  return (
    <div className="flex gap-1" role="img" aria-label={`Estimate at level ${estimate}; 95% range levels ${low} to ${high}`}>
      {[1, 2, 3, 4, 5].map((l) => (
        <div key={l} className="flex-1">
          <div
            className={cn(
              "flex h-7 items-center justify-center rounded-md text-xs tabular-nums",
              l >= low && l <= high ? "bg-[color-mix(in_oklch,var(--series-1)_16%,var(--card))]" : "bg-muted",
              l === estimate && "font-semibold ring-2 ring-[var(--series-1)]",
            )}
          >
            {l}
          </div>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{value}</dd>
    </div>
  );
}

export function DomainCard({ d }: { d: DomainResult }) {
  return (
    <article className="h-full rounded-xl border bg-card p-5 sm:p-6" aria-labelledby={`dom-${d.domain}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`dom-${d.domain}`} className="text-base font-semibold">
          {d.label}
        </h3>
        <div className="flex gap-1.5">
          {d.status === "partial" && <Badge variant="outline">Partly completed</Badge>}
          {d.status === "not-administered" && <Badge variant="outline">Not completed</Badge>}
          <Badge variant="outline" className="font-mono text-[11px]">
            {d.domain}
          </Badge>
        </div>
      </header>

      {d.scoring === "irt" && d.level && (
        <div className="mt-4">
          <p className="text-[0.95rem]">
            Provisional level <span className="font-semibold">{d.level.estimate}</span>{" "}
            <span className="text-muted-foreground">· {LEVEL_LABELS[d.level.estimate]}</span>
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Likely range: level {d.level.low}
            {d.level.high !== d.level.low ? `–${d.level.high}` : ""} (95%)
          </p>
          <div className="mt-3">
            <LevelLadder estimate={d.level.estimate} low={d.level.low} high={d.level.high} />
          </div>
          {(d.level.estimate === 1 || d.level.estimate === 5) && (
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              This is at the {d.level.estimate === 5 ? "top" : "bottom"} of what this test can measure. Estimates near the
              edges are pulled toward the middle, so your true level could be {d.level.estimate === 5 ? "higher" : "lower"} than shown.
            </p>
          )}
        </div>
      )}

      {d.scoring === "irt" && d.items > 0 && (
        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Stat label="Questions" value={d.items} />
          <Stat label="Correct" value={`${d.correct} (${formatPercent(d.accuracy)})`} />
          <Stat label="Hardest solved" value={d.highestLevelCorrect ? `Level ${d.highestLevelCorrect}` : "—"} />
          <Stat label="Median time" value={formatSeconds(d.medianRtMs)} />
        </dl>
      )}

      {d.spans && d.spans.length > 0 && (
        <table className="mt-5 w-full text-sm">
          <caption className="sr-only">Working memory tasks</caption>
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="pb-1.5 font-medium">Task</th>
              <th className="pb-1.5 font-medium">Longest recalled</th>
              <th className="pb-1.5 font-medium">Sequences correct</th>
            </tr>
          </thead>
          <tbody>
            {d.spans.map((s) => (
              <tr key={s.task} className="border-t">
                <td className="py-2">{s.label}</td>
                <td className="py-2 tabular-nums">{s.longestCorrect ?? "—"}</td>
                <td className="py-2 tabular-nums">
                  {s.trialsCorrect} of {s.trialsTotal}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {d.speed && (
        <div className="mt-4">
          {d.speed.blocks.length === 0 ? (
            <p className="text-sm text-muted-foreground">The speed tasks were not completed.</p>
          ) : (
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Processing speed results (scrollable)">
              <table className="w-full min-w-[30rem] text-sm">
                <caption className="sr-only">Processing speed tasks</caption>
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-1.5 font-medium">Task</th>
                    <th className="pb-1.5 font-medium">Answered</th>
                    <th className="pb-1.5 font-medium">Errors</th>
                    <th className="pb-1.5 font-medium">Net per minute</th>
                    <th className="pb-1.5 font-medium">Median time</th>
                    <th className="pb-1.5 font-medium">Beyond reaction time</th>
                  </tr>
                </thead>
                <tbody>
                  {d.speed.blocks.map((b) => (
                    <tr key={b.task} className="border-t">
                      <td className="py-2">{b.label}</td>
                      <td className="py-2 tabular-nums">{b.attempted}</td>
                      <td className="py-2 tabular-nums">{b.errors}</td>
                      <td className="py-2 tabular-nums">{b.netPerMinute.toFixed(1)}</td>
                      <td className="py-2 tabular-nums">{b.medianRtMs === null ? "—" : `${Math.round(b.medianRtMs)} ms`}</td>
                      <td className="py-2 tabular-nums">{b.adjustedMedianMs === null ? "—" : `${Math.round(b.adjustedMedianMs)} ms`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Simple reaction time on this device: {d.speed.baselineMedianMs === null ? "not measured" : `${Math.round(d.speed.baselineMedianMs)} ms`}. “Net per minute”
            is correct minus incorrect answers per minute. Speed tasks are scored as rates, not with the difficulty scale.
          </p>
        </div>
      )}

      {(d.stopReasons.length > 0 || d.notes.length > 0) && (
        <ul className="mt-5 space-y-1 border-t pt-4 text-xs leading-5 text-muted-foreground">
          {d.scoring === "irt" &&
            d.domain !== "Gwm" &&
            d.stopReasons.map((r) => <li key={r}>Section ended: {STOP_REASON_TEXT[r as StopReason]?.toLowerCase() ?? r}.</li>)}
          {d.domain === "Gwm" && d.spans?.map((s) => s.stopReason && <li key={s.task}>{s.label}: ended because {SPAN_STOP[s.stopReason] ?? s.stopReason}.</li>)}
          {d.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </article>
  );
}
