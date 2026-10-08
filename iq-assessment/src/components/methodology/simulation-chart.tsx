"use client";

import { useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import summary from "@/data/simulation-summary.json";
import { Button } from "@/components/ui/button";

type Row = (typeof summary.results)[number];

const SERIES = [
  { key: "provisional", label: "Responses follow the assumed model", color: "var(--series-1)" },
  { key: "misspecified", label: "Responses follow a different model", color: "var(--series-2)" },
] as const;

/** Simulated bias of the quick-mode estimate across true ability, for both conditions. */
export function SimulationBiasChart() {
  const [table, setTable] = useState(false);
  const rows = summary.results.filter((r) => r.mode === "quick" && r.domain === "Gf") as Row[];
  const thetas = rows[0].grid.map((g) => g.theta);
  const data = thetas.map((theta) => ({
    theta,
    provisional: rows.find((r) => r.condition === "provisional")!.grid.find((g) => g.theta === theta)!.bias,
    misspecified: rows.find((r) => r.condition === "misspecified")!.grid.find((g) => g.theta === theta)!.bias,
  }));
  return (
    <figure className="not-prose rounded-xl border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground" aria-label="Legend">
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <span aria-hidden className="h-0.5 w-5 rounded" style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
        <Button variant="ghost" size="sm" onClick={() => setTable(!table)} aria-pressed={table}>
          {table ? "Show chart" : "Show as table"}
        </Button>
      </div>
      {table ? (
        <table className="mt-4 w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1.5 font-medium">True θ</th>
              <th className="py-1.5 font-medium">Bias (assumed model)</th>
              <th className="py-1.5 font-medium">Bias (different model)</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.theta} className="border-t tabular-nums">
                <td className="py-1.5">{d.theta}</td>
                <td className="py-1.5">{d.provisional.toFixed(2)}</td>
                <td className="py-1.5">{d.misspecified.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="mt-4 h-64 w-full" role="img" aria-label="Simulated bias of the quick-mode estimate by true ability. Bias is near zero in the middle and grows at both extremes. A table version is available.">
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height: 260 }}>
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeWidth={1} />
              <XAxis
                dataKey="theta"
                type="number"
                domain={[-3.5, 3.5]}
                ticks={[-3, -2, -1, 0, 1, 2, 3]}
                tickLine={false}
                axisLine={{ stroke: "var(--chart-grid)" }}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                label={{ value: "True ability (logit)", position: "insideBottomRight", offset: -2, fill: "var(--muted-foreground)", fontSize: 11 }}
                height={34}
              />
              <YAxis
                domain={[-1.5, 1.5]}
                ticks={[-1.5, -1, -0.5, 0, 0.5, 1, 1.5]}
                allowDataOverflow
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                width={44}
                label={{ value: "Bias", angle: -90, position: "insideLeft", offset: 18, fill: "var(--muted-foreground)", fontSize: 11 }}
              />
              <Tooltip
                cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-sm">
                      <p className="font-semibold">True θ = {label}</p>
                      {payload.map((p) => (
                        <p key={String(p.dataKey)} className="mt-0.5 flex items-center gap-2 text-muted-foreground">
                          <span aria-hidden className="h-0.5 w-3 rounded" style={{ background: p.color }} />
                          <span className="font-medium text-foreground">{Number(p.value).toFixed(2)}</span>
                          {SERIES.find((s) => s.key === p.dataKey)?.label}
                        </p>
                      ))}
                    </div>
                  ) : null
                }
              />
              {SERIES.map((s) => (
                <Line key={s.key} dataKey={s.key} stroke={s.color} strokeWidth={2} dot={{ r: 3, fill: s.color, strokeWidth: 0 }} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <figcaption className="mt-3 text-xs leading-5 text-muted-foreground">
        Quick mode, {summary.results.find((r) => r.mode === "quick")?.grid.length} ability levels × 200 simulees each. Positive bias
        means over-estimation. Simulation under assumed models — not validation evidence.
      </figcaption>
    </figure>
  );
}
