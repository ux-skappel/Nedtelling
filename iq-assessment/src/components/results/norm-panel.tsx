import { Lock } from "lucide-react";
import { DOMAIN_LABELS } from "@/lib/items/types";
import type { Eligibility, NormReferencedReport } from "@/lib/scoring/validated";

/**
 * Norm-referenced scores. Today this always renders the locked state, because
 * no validated norms exist; the scored state is exercised by tests with
 * explicitly fake fixtures and is ready for genuine norms.
 */
export function NormPanel({ eligibility, report }: { eligibility: Eligibility; report: NormReferencedReport | null }) {
  if (!eligibility.eligible || !report) {
    const reasons = eligibility.eligible ? [] : eligibility.reasons;
    return (
      <div className="rounded-xl border border-dashed bg-card p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <h3 className="font-semibold">Norm-referenced scores are not available</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              An IQ, a percentile or an age-adjusted standard score compares you with a representative reference group. This
              test does not have one yet, so these numbers cannot be computed honestly — and are not shown.
            </p>
            <ul className="mt-3 space-y-1 text-sm">
              {reasons.map((r) => (
                <li key={r} className="flex gap-2">
                  <span aria-hidden className="text-muted-foreground">
                    –
                  </span>
                  {r}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-muted-foreground">
              When validated norms exist, this panel will show a full-scale estimate (if the norming study supports a
              composite), domain standard scores, 95% confidence intervals and age-adjusted percentiles.
            </p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border bg-card p-5 sm:p-6">
      {report.composite && (
        <div className="border-b pb-5">
          <p className="eyebrow">Full-scale estimate</p>
          <p className="mt-2 text-5xl font-semibold tabular-nums">{report.composite.standardScore}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            95% confidence interval {report.composite.ci95[0]}–{report.composite.ci95[1]} · percentile {report.composite.percentile}
          </p>
        </div>
      )}
      <table className="mt-4 w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-1.5 font-medium">Domain</th>
            <th className="py-1.5 font-medium">Standard score</th>
            <th className="py-1.5 font-medium">95% CI</th>
            <th className="py-1.5 font-medium">Percentile</th>
          </tr>
        </thead>
        <tbody>
          {report.domains.map((d) => (
            <tr key={d.domain} className="border-t">
              <td className="py-2">{d.domain === "composite" ? "Composite" : DOMAIN_LABELS[d.domain]}</td>
              <td className="py-2 tabular-nums">{d.standardScore}</td>
              <td className="py-2 tabular-nums">
                {d.ci95[0]}–{d.ci95[1]}
              </td>
              <td className="py-2 tabular-nums">{d.percentile}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
