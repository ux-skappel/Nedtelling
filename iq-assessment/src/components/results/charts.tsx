"use client";

import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { LEVEL_LABELS, levelFromLogit } from "@/lib/items/difficulty";
import type { DifficultyLevel } from "@/lib/items/types";
import type { DomainResult } from "@/lib/scoring/development";

const DOMAIN_MIN = -3.5;
const DOMAIN_MAX = 3.5;
const LEVEL_CENTERS = [-2, -1, 0, 1, 2];
const LEVEL_EDGES = [-1.5, -0.5, 0.5, 1.5];

const clampTheta = (x: number) => Math.max(DOMAIN_MIN, Math.min(DOMAIN_MAX, x));
const levelTick = (v: number) => String(levelFromLogit(v));

function TooltipCard({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-sm">{children}</div>;
}

/** Ring-and-dot marker with a surface-coloured ring (stays legible over lines). */
function Dot(props: { cx?: number; cy?: number; fill: string; hollow?: boolean; r?: number }) {
  const { cx, cy, fill, hollow, r = 5 } = props;
  if (cx === undefined || cy === undefined) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={12} fill="transparent" />
      <circle cx={cx} cy={cy} r={r + 2} fill="var(--card)" />
      <circle cx={cx} cy={cy} r={r} fill={hollow ? "var(--card)" : fill} stroke={fill} strokeWidth={hollow ? 2 : 0} />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Profile: provisional estimate ± 95% interval per domain
// ---------------------------------------------------------------------------

export function ProfileChart({ domains }: { domains: DomainResult[] }) {
  const data = domains
    .filter((d) => d.theta !== null && d.ci95 !== null)
    .map((d) => ({
      label: d.label.replace(" (crystallised)", ""),
      theta: clampTheta(d.theta!),
      range: [clampTheta(d.ci95![0]), clampTheta(d.ci95![1])] as [number, number],
      level: d.level!,
    }));
  const height = 56 + data.length * 52;
  return (
    <figure>
      <div style={{ height }} className="w-full" role="img" aria-label="Provisional ability estimates with 95% intervals, by domain. A table version follows.">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height: 260 }}>
          <ComposedChart data={data} layout="vertical" margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid horizontal={false} vertical={false} />
            {LEVEL_EDGES.map((x) => (
              <ReferenceLine key={x} x={x} stroke="var(--chart-grid)" strokeWidth={1} />
            ))}
            <XAxis
              type="number"
              domain={[DOMAIN_MIN, DOMAIN_MAX]}
              ticks={LEVEL_CENTERS}
              tickFormatter={levelTick}
              tickLine={false}
              axisLine={{ stroke: "var(--chart-grid)" }}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              label={{ value: "Difficulty level", position: "insideBottom", offset: -4, fill: "var(--muted-foreground)", fontSize: 11 }}
              height={40}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={128}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--foreground)", fontSize: 12.5 }}
            />
            <Tooltip
              cursor={{ fill: "var(--chart-band)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as (typeof data)[number];
                return (
                  <TooltipCard>
                    <p className="font-semibold text-foreground">
                      Level {p.level.estimate} · {LEVEL_LABELS[p.level.estimate]}
                    </p>
                    <p className="mt-0.5 text-muted-foreground">{p.label}</p>
                    <p className="mt-1 text-muted-foreground">
                      95% range: level {p.level.low}–{p.level.high}
                    </p>
                  </TooltipCard>
                );
              }}
            />
            <Bar dataKey="range" barSize={2} fill="var(--series-1)" isAnimationActive={false} />
            <Scatter dataKey="theta" fill="var(--series-1)" isAnimationActive={false} shape={(p: { cx?: number; cy?: number }) => <Dot cx={p.cx} cy={p.cy} fill="var(--series-1)" />} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 text-xs leading-5 text-muted-foreground">
        Dots mark each provisional estimate; lines show the 95% interval. Levels 1–5 run from introductory to expert items in
        this bank. Positions are relative to the questions, not to other people.
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Trajectory: how the estimate converged, and the difficulty of each item
// ---------------------------------------------------------------------------

export function TrajectoryChart({ domain }: { domain: DomainResult }) {
  const data = domain.trajectory.map((t) => ({
    index: t.index,
    theta: clampTheta(t.theta),
    band: [clampTheta(t.theta - t.se), clampTheta(t.theta + t.se)] as [number, number],
    right: t.correct ? clampTheta(t.b) : null,
    wrong: t.correct ? null : clampTheta(t.b),
    level: levelFromLogit(t.b) as DifficultyLevel,
    correct: t.correct,
  }));
  return (
    <figure>
      <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground" aria-label="Legend">
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-0.5 w-5 rounded bg-[var(--series-1)]" /> Provisional estimate (band: ±1 standard error)
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden className="size-2.5 rounded-full bg-[var(--series-2)]" /> Question answered correctly (its difficulty)
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden className="size-2.5 rounded-full border-2 border-[var(--series-2)]" /> Answered incorrectly
        </li>
      </ul>
      <div className="h-64 w-full sm:h-72" role="img" aria-label={`How the ${domain.label} estimate changed after each question. A table version follows.`}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height: 260 }}>
          <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="index"
              tickLine={false}
              axisLine={{ stroke: "var(--chart-grid)" }}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              label={{ value: "Question", position: "insideBottomRight", offset: -2, fill: "var(--muted-foreground)", fontSize: 11 }}
              height={32}
            />
            <YAxis
              domain={[DOMAIN_MIN, DOMAIN_MAX]}
              ticks={LEVEL_CENTERS}
              tickFormatter={levelTick}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              width={40}
              label={{ value: "Level", angle: -90, position: "insideLeft", offset: 18, fill: "var(--muted-foreground)", fontSize: 11 }}
            />
            <Tooltip
              cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as (typeof data)[number];
                return (
                  <TooltipCard>
                    <p className="font-semibold text-foreground">Question {p.index}</p>
                    <p className="mt-0.5 text-muted-foreground">
                      Difficulty level {p.level} · {p.correct ? "correct" : "incorrect"}
                    </p>
                    <p className="text-muted-foreground">Estimate afterwards: level {levelFromLogit(p.theta)}</p>
                  </TooltipCard>
                );
              }}
            />
            <Area dataKey="band" stroke="none" fill="var(--series-1)" fillOpacity={0.1} isAnimationActive={false} />
            <Line dataKey="theta" stroke="var(--series-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Scatter
              dataKey="right"
              isAnimationActive={false}
              shape={(p: { cx?: number; cy?: number; payload?: { right: number | null } }) =>
                p.payload?.right == null ? <g /> : <Dot cx={p.cx} cy={p.cy} r={4} fill="var(--series-2)" />
              }
            />
            <Scatter
              dataKey="wrong"
              isAnimationActive={false}
              shape={(p: { cx?: number; cy?: number; payload?: { wrong: number | null } }) =>
                p.payload?.wrong == null ? <g /> : <Dot cx={p.cx} cy={p.cy} r={4} fill="var(--series-2)" hollow />
              }
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
