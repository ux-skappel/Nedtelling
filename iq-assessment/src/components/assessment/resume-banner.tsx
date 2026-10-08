"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { getRepository } from "@/lib/assessment/browser";
import type { SessionSummary } from "@/lib/assessment/repository";

/** Offers to continue an unfinished assessment stored on this device. */
export function ResumeBanner() {
  const [active, setActive] = useState<SessionSummary | null>(null);

  useEffect(() => {
    const repo = getRepository();
    (async () => {
      const id = await repo.getActiveId();
      if (!id) return;
      const s = (await repo.list()).find((x) => x.id === id);
      if (s && s.completedAt === null) setActive(s);
    })();
  }, []);

  if (!active) return null;
  return (
    <div className="mt-8 flex flex-col gap-3 rounded-xl border border-notice-border bg-notice px-5 py-4 text-notice-foreground sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm">
        You have an unfinished {active.mode} assessment from {new Date(active.createdAt).toLocaleString()}.
      </p>
      <Button asChild size="sm">
        <Link href="/test">Continue where you left off</Link>
      </Button>
    </div>
  );
}
