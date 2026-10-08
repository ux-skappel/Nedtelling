"use client";

import { useEffect, useRef, useState } from "react";

function fmt(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * A quiet time indicator: a thin bar that empties over the item's time limit.
 * The remaining seconds become visible (and are announced once) in the last
 * 30 seconds, so the clock does not dominate attention for most of the item.
 */
export function TimeBar({ remainingMs, limitMs }: { remainingMs: number; limitMs: number }) {
  const fraction = Math.max(0, Math.min(1, remainingMs / limitMs));
  const urgent = remainingMs <= 30_000;
  const [announce, setAnnounce] = useState("");
  const announced = useRef(new Set<number>());

  useEffect(() => {
    for (const mark of [30_000, 10_000]) {
      if (remainingMs <= mark && remainingMs > 0 && !announced.current.has(mark)) {
        announced.current.add(mark);
        setAnnounce(`${mark / 1000} seconds left on this question.`);
      }
    }
  }, [remainingMs]);

  return (
    <div className="flex items-center gap-3">
      <div
        className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Time remaining on this question"
        aria-valuemin={0}
        aria-valuemax={Math.round(limitMs / 1000)}
        aria-valuenow={Math.round(remainingMs / 1000)}
        aria-valuetext={`${fmt(remainingMs)} remaining`}
      >
        <div className="h-full rounded-full bg-foreground/70 transition-[width] duration-300 ease-linear" style={{ width: `${fraction * 100}%` }} />
      </div>
      <span className={urgent ? "w-10 text-right text-xs font-medium tabular-nums" : "w-10 text-right text-xs tabular-nums text-muted-foreground/70"}>
        {fmt(remainingMs)}
      </span>
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}
