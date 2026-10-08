"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Download, Trash2 } from "lucide-react";
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
import { getRepository } from "@/lib/assessment/browser";
import type { SessionSummary } from "@/lib/assessment/repository";
import type { Session } from "@/lib/assessment/session";
import { formatDate } from "@/lib/format";
import { toCsv, toLongFormat } from "@/lib/norms/analysis";

export function HistoryList() {
  const router = useRouter();
  const [list, setList] = useState<SessionSummary[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const repo = getRepository();
    return Promise.all([repo.list(), repo.getActiveId()]).then(([l, a]) => {
      setList(l);
      setActiveId(a);
    });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function exportResearch() {
    const repo = getRepository();
    const sessions = (await Promise.all((await repo.list()).map((s) => repo.load(s.id)))).filter((s): s is Session => !!s);
    const rows = toLongFormat(sessions);
    const blob = new Blob([toCsv(rows)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tanke-responses-long.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (list === null) return <p className="text-muted-foreground">Loading…</p>;
  if (list.length === 0)
    return (
      <div className="rounded-xl border bg-card p-6">
        <p>No assessments are stored on this device.</p>
        <Button asChild className="mt-4">
          <Link href="/">Start an assessment</Link>
        </Button>
      </div>
    );

  return (
    <div>
      <ul className="divide-y rounded-xl border bg-card">
        {list.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{s.mode === "quick" ? "Quick assessment" : "Full assessment"}</p>
              <p className="text-sm text-muted-foreground">{formatDate(s.createdAt)}</p>
            </div>
            {s.completedAt === null ? (
              <Badge variant="outline">In progress</Badge>
            ) : s.endedEarly ? (
              <Badge variant="outline">Ended early</Badge>
            ) : (
              <Badge variant="outline">Completed</Badge>
            )}
            {s.completedAt !== null ? (
              <Button asChild size="sm" variant="outline">
                <Link href={`/results/${s.id}`}>View results</Link>
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await getRepository().setActiveId(s.id);
                  router.push("/test");
                }}
              >
                {activeId === s.id ? "Continue" : "Resume"}
              </Button>
            )}
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Delete the assessment from ${formatDate(s.createdAt)}`}
              onClick={async () => {
                await getRepository().remove(s.id);
                refresh();
              }}
            >
              <Trash2 aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button variant="outline" onClick={exportResearch}>
          <Download aria-hidden /> Export research data (CSV)
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" className="text-muted-foreground">
              <Trash2 aria-hidden /> Delete everything
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete all stored assessments?</AlertDialogTitle>
              <AlertDialogDescription>This removes every result and unfinished assessment from this device.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  await getRepository().clearAll();
                  refresh();
                }}
              >
                Delete everything
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <p className="mt-4 max-w-2xl text-xs leading-5 text-muted-foreground">
        The research export contains one row per answer, only from assessments where you agreed to research use, without
        names or contact details. It is saved to your computer; nothing is uploaded.
      </p>
    </div>
  );
}
