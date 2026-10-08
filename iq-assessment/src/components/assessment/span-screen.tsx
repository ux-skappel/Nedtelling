"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CornerDownLeft, Delete, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { scoreResponse, type Item, type ResponseValue } from "@/lib/items/types";
import { cn } from "@/lib/utils";
import type { ItemResult } from "./item-screen";
import { TimeBar } from "./time-bar";
import { useItemTimer } from "./use-item-timer";

interface Props {
  item: Item;
  mode: "practice" | "test";
  timeLimitMs: number | null;
  hidden: boolean;
  onPresented?: (epochMs: number) => void;
  onSubmit: (result: ItemResult) => void;
}

type Phase = "ready" | "presenting" | "recall" | "feedback";

/**
 * One span trial: a short "get ready" pause, sequential presentation (one
 * element per second), then recall. The response timer runs only during
 * recall.
 */
export function SpanScreen({ item, mode, timeLimitMs, hidden, onPresented, onSubmit }: Props) {
  const spatial = item.stimulus.type === "spatial-span";
  const sequence = item.stimulus.type === "span" ? item.stimulus.sequence : item.stimulus.type === "spatial-span" ? item.stimulus.sequence.map(String) : [];
  const onMs = item.stimulus.type === "span" || item.stimulus.type === "spatial-span" ? item.stimulus.presentationMs : 800;
  const offMs = item.stimulus.type === "span" || item.stimulus.type === "spatial-span" ? item.stimulus.interStimulusMs : 200;
  const alphabet = useMemo(() => (item.response.kind === "sequence" ? item.response.alphabet : []), [item]);

  const [phase, setPhase] = useState<Phase>("ready");
  const [shown, setShown] = useState<string | null>(null);
  const [entered, setEntered] = useState<string[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ correct: boolean; result: ItemResult } | null>(null);
  const done = useRef(false);

  // Presentation sequence.
  useEffect(() => {
    if (phase !== "ready") return;
    const timeouts: number[] = [];
    let t = 1200;
    timeouts.push(window.setTimeout(() => setPhase("presenting"), t - 50));
    sequence.forEach((el) => {
      timeouts.push(window.setTimeout(() => setShown(el), t));
      t += onMs;
      timeouts.push(window.setTimeout(() => setShown(null), t));
      t += offMs;
    });
    timeouts.push(window.setTimeout(() => setPhase("recall"), t + 150));
    onPresented?.(Date.now());
    return () => timeouts.forEach((x) => window.clearTimeout(x));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const finish = useCallback(
    (result: ItemResult) => {
      if (done.current) return;
      if (mode === "practice") {
        setFeedback({ correct: scoreResponse(item, result.response), result });
        setPhase("feedback");
        return;
      }
      done.current = true;
      onSubmit(result);
    },
    [mode, item, onSubmit],
  );

  const response = (): ResponseValue => ({ kind: "sequence", values: entered });

  const timer = useItemTimer({
    limitMs: mode === "practice" ? null : timeLimitMs,
    initialElapsedMs: 0,
    hidden,
    active: phase === "recall",
    onTimeout: (e) => finish({ response: response(), rtMs: e, timedOut: true }),
  });

  const add = useCallback(
    (x: string) => {
      if (phase !== "recall") return;
      setEntered((prev) => (prev.length >= 12 ? prev : [...prev, x]));
      if (spatial) {
        setFlash(x);
        window.setTimeout(() => setFlash(null), 180);
      }
    },
    [phase, spatial],
  );

  const submit = useCallback(() => {
    if (phase !== "recall" || entered.length === 0) return;
    finish({ response: { kind: "sequence", values: entered }, rtMs: timer.stop(), timedOut: false });
  }, [phase, entered, finish, timer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (phase === "feedback" && e.key === "Enter" && feedback) {
        e.preventDefault();
        done.current = true;
        onSubmit(feedback.result);
        return;
      }
      if (phase !== "recall") return;
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      } else if (e.key === "Backspace") {
        e.preventDefault();
        setEntered((p) => p.slice(0, -1));
      } else if (!spatial) {
        const k = e.key.toUpperCase();
        if (alphabet.includes(k)) {
          e.preventDefault();
          add(k);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, submit, add, alphabet, spatial, feedback, onSubmit]);

  const blocks = item.stimulus.type === "spatial-span" ? item.stimulus.blocks : [];
  const letters = alphabet.filter((x) => /[A-Z]/.test(x));
  const digits = alphabet.filter((x) => /[0-9]/.test(x));

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-4 pb-10 sm:px-8">
      {mode === "test" && phase === "recall" && timeLimitMs !== null && <TimeBar remainingMs={timer.remainingMs ?? 0} limitMs={timeLimitMs} />}
      {mode === "practice" && <p className="mb-3 inline-flex rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">Practice — not scored</p>}
      <h2 className="mt-3 text-lg font-medium sm:text-xl">{phase === "recall" || phase === "feedback" ? item.prompt : spatial ? "Watch the blocks." : "Watch the sequence."}</h2>
      <p className="sr-only" aria-live="assertive">
        {phase === "presenting" && shown && !spatial ? shown : ""}
        {phase === "recall" ? "Now enter your answer." : ""}
      </p>

      {spatial ? (
        <div className="relative mx-auto mt-8 aspect-square w-full max-w-[22rem]" aria-label="Nine blocks">
          {blocks.map(([x, y], i) => {
            const lit = (phase === "presenting" && shown === String(i)) || flash === String(i);
            return (
              <button
                key={i}
                type="button"
                aria-label={`Block ${i + 1}`}
                disabled={phase !== "recall"}
                onClick={() => add(String(i))}
                className={cn(
                  "absolute size-[15%] -translate-x-1/2 -translate-y-1/2 rounded-md border-2 border-foreground/70 transition-colors duration-75 disabled:opacity-100",
                  lit ? "bg-foreground" : "bg-card hover:bg-muted",
                )}
                style={{ left: `${x}%`, top: `${y}%` }}
              />
            );
          })}
        </div>
      ) : (
        <div className="mt-10 flex h-32 items-center justify-center" aria-hidden={phase !== "presenting"}>
          {phase === "ready" && <span className="text-sm text-muted-foreground">Get ready…</span>}
          {phase === "presenting" && <span className="font-mono text-7xl font-semibold tabular-nums">{shown ?? ""}</span>}
          {(phase === "recall" || phase === "feedback") && (
            <div className="flex min-h-14 flex-wrap justify-center gap-1.5" aria-label="Your answer so far">
              {entered.length === 0 && <span className="self-center text-muted-foreground">Your answer will appear here</span>}
              {entered.map((x, i) => (
                <span key={i} className="flex size-12 items-center justify-center rounded-md border bg-card font-mono text-2xl">
                  {x}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {spatial && phase === "ready" && <p className="mt-4 text-center text-sm text-muted-foreground">Get ready…</p>}
      {spatial && (phase === "recall" || phase === "feedback") && (
        <p className="mt-4 text-center text-sm text-muted-foreground" aria-live="polite">
          {entered.length} block{entered.length === 1 ? "" : "s"} selected
        </p>
      )}

      {phase === "recall" && (
        <div className="mt-6">
          {!spatial && (
            <div className="mx-auto grid max-w-sm grid-cols-5 gap-1.5 sm:grid-cols-6">
              {[...digits, ...letters].map((x) => (
                <Button key={x} variant="outline" className="h-12 font-mono text-lg" onClick={() => add(x)}>
                  {x}
                </Button>
              ))}
            </div>
          )}
          <div className="mx-auto mt-5 flex max-w-sm justify-between gap-2">
            <Button variant="ghost" onClick={() => setEntered((p) => p.slice(0, -1))} disabled={entered.length === 0}>
              <Delete aria-hidden /> Undo
            </Button>
            <Button size="lg" className="h-11 min-w-32" onClick={submit} disabled={entered.length === 0}>
              Done <CornerDownLeft aria-hidden />
            </Button>
          </div>
        </div>
      )}

      {phase === "feedback" && feedback && (
        <div className="mt-8 rounded-xl border bg-card p-5" role="status">
          <p className="flex items-center gap-2 font-medium">
            {feedback.correct ? <Check className="size-4" aria-hidden /> : <X className="size-4" aria-hidden />}
            {feedback.correct ? "Correct." : "Not quite."}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{item.explanation}</p>
          <div className="mt-4 flex justify-end">
            <Button
              onClick={() => {
                done.current = true;
                onSubmit(feedback.result);
              }}
            >
              Continue <CornerDownLeft aria-hidden />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
