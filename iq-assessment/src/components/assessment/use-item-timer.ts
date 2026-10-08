"use client";

import { useEffect, useRef, useState } from "react";
import { afterNextPaint, ResponseTimer } from "@/lib/assessment/timing";

interface Options {
  /** Hard limit in ms, or null for untimed. */
  limitMs: number | null;
  /** Time already spent before an interruption. */
  initialElapsedMs: number;
  /** The page is hidden: pause the clock. */
  hidden: boolean;
  /** Start only when true (e.g. after a presentation phase). */
  active: boolean;
  onPresented?: (epochMs: number) => void;
  onHeartbeat?: (elapsedMs: number) => void;
  onTimeout?: (elapsedMs: number) => void;
}

/**
 * Starts a response timer on the first painted frame, pauses it while the
 * page is hidden, reports a heartbeat for crash recovery, and fires
 * `onTimeout` when the limit is reached.
 */
export function useItemTimer({ limitMs, initialElapsedMs, hidden, active, onPresented, onHeartbeat, onTimeout }: Options) {
  const timerRef = useRef<ResponseTimer | null>(null);
  const [elapsed, setElapsed] = useState(initialElapsedMs);
  const [started, setStarted] = useState(false);
  const callbacks = useRef({ onPresented, onHeartbeat, onTimeout });
  const firedTimeout = useRef(false);

  useEffect(() => {
    callbacks.current = { onPresented, onHeartbeat, onTimeout };
  });

  useEffect(() => {
    if (!active) return;
    const timer = new ResponseTimer(undefined, initialElapsedMs);
    timerRef.current = timer;
    const cancel = afterNextPaint(() => {
      timer.start();
      setStarted(true);
      callbacks.current.onPresented?.(Date.now());
    });
    return () => {
      cancel();
    };
    // initialElapsedMs is read once per activation on purpose
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    const t = timerRef.current;
    if (!t) return;
    if (hidden) t.pause();
    else t.resume();
  }, [hidden]);

  useEffect(() => {
    if (!started) return;
    let beat = 0;
    const id = window.setInterval(() => {
      const t = timerRef.current;
      if (!t) return;
      const e = t.elapsed();
      setElapsed(e);
      beat += 1;
      if (beat % 8 === 0) callbacks.current.onHeartbeat?.(e);
      if (limitMs !== null && e >= limitMs && !firedTimeout.current) {
        firedTimeout.current = true;
        callbacks.current.onTimeout?.(e);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [started, limitMs]);

  return {
    started,
    elapsedMs: elapsed,
    remainingMs: limitMs === null ? null : Math.max(0, limitMs - elapsed),
    /** Stop and return the active response time. */
    stop: () => timerRef.current?.stop().activeMs ?? elapsed,
    read: () => timerRef.current?.elapsed() ?? elapsed,
  };
}

export function usePageHidden(): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const on = () => setHidden(document.visibilityState === "hidden");
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return hidden;
}
