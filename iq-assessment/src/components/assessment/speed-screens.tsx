"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StimulusView } from "@/components/stimuli/stimulus";
import { afterNextPaint, measureFrameInterval } from "@/lib/assessment/timing";
import type { BaselineTrial, PracticeRecord, SpeedBlockResult, SpeedTrialRecord } from "@/lib/assessment/session";
import type { SpeedBlockBlueprint } from "@/lib/assessment/blueprint";
import type { Item } from "@/lib/items/types";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Simple-reaction-time baseline
// ---------------------------------------------------------------------------

/**
 * Measures the participant's simple reaction time on this device (signal →
 * key/tap). It absorbs display and input latency as well as motor speed, so
 * speed-task response times can be reported net of it.
 */
export function BaselineScreen({ trials, onDone }: { trials: number; onDone: (t: BaselineTrial[]) => void }) {
  const [phase, setPhase] = useState<"intro" | "wait" | "go" | "early" | "done">("intro");
  const [results, setResults] = useState<BaselineTrial[]>([]);
  const signalAt = useRef<number | null>(null);
  const foreperiod = useRef(0);
  const timeout = useRef<number | null>(null);

  const next = useCallback(() => {
    foreperiod.current = 800 + Math.round(Math.random() * 1200);
    signalAt.current = null;
    setPhase("wait");
    timeout.current = window.setTimeout(() => {
      setPhase("go");
      afterNextPaint(() => {
        signalAt.current = performance.now();
      });
    }, foreperiod.current);
  }, []);

  const respond = useCallback(
    (eventTime: number) => {
      if (phase === "wait") {
        if (timeout.current) window.clearTimeout(timeout.current);
        const r = [...results, { foreperiodMs: foreperiod.current, rtMs: null, anticipation: true }];
        setResults(r);
        setPhase("early");
        window.setTimeout(() => (r.length >= trials + 2 ? onDone(r) : next()), 900);
        return;
      }
      if (phase === "go" && signalAt.current !== null) {
        const rt = Math.max(0, eventTime - signalAt.current);
        const r = [...results, { foreperiodMs: foreperiod.current, rtMs: Math.round(rt), anticipation: false }];
        setResults(r);
        const valid = r.filter((x) => !x.anticipation).length;
        if (valid >= trials || r.length >= trials + 2) {
          setPhase("done");
          window.setTimeout(() => onDone(r), 400);
        } else window.setTimeout(next, 500);
      }
    },
    [phase, results, trials, next, onDone],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        if (phase === "intro") next();
        else respond(e.timeStamp);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, next, respond]);

  useEffect(() => () => {
    if (timeout.current) window.clearTimeout(timeout.current);
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center px-4 pt-6 pb-10 text-center sm:px-8">
      <h2 className="text-lg font-medium sm:text-xl">Reaction check</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Press <kbd className="rounded border px-1.5 font-mono text-xs">Space</kbd> or tap the square as soon as it turns dark. {trials} trials.
      </p>
      <button
        type="button"
        aria-label={phase === "go" ? "Respond now" : "Reaction square"}
        onPointerDown={(e) => {
          if (phase !== "intro") respond(e.timeStamp);
        }}
        className={cn(
          "mt-10 size-48 rounded-2xl border-2 border-foreground/70 transition-none select-none sm:size-56",
          phase === "go" ? "bg-foreground" : "bg-muted",
        )}
      />
      <p className="mt-6 h-6 text-sm" aria-live="polite">
        {phase === "early" && "Too early — wait for the square to turn dark."}
        {phase === "done" && "Done."}
        {(phase === "wait" || phase === "go") && `Trial ${Math.min(results.filter((r) => !r.anticipation).length + 1, trials)} of ${trials}`}
      </p>
      {phase === "intro" && (
        <Button size="lg" className="mt-4 h-11" onClick={next}>
          Start
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timed speed block
// ---------------------------------------------------------------------------

interface BlockProps {
  block: SpeedBlockBlueprint;
  trials: Item[];
  practice: Item[];
  glyphs: number[][];
  onDone: (r: SpeedBlockResult) => void;
  onRestart: () => void;
}

const COPY: Record<SpeedBlockBlueprint["task"], { title: string; how: string }> = {
  "symbol-search": {
    title: "Symbol search",
    how: "Decide whether either of the two boxed symbols on the left appears in the row on the right.",
  },
  "visual-comparison": {
    title: "Visual comparison",
    how: "Decide whether the two strings of letters and digits are exactly the same.",
  },
};

export function SpeedBlockScreen({ block, trials, practice, glyphs, onDone, onRestart }: BlockProps) {
  const [phase, setPhase] = useState<"practice" | "ready" | "running" | "interrupted">(practice.length ? "practice" : "ready");
  const [pIndex, setPIndex] = useState(0);
  const [pFeedback, setPFeedback] = useState<boolean | null>(null);
  const [practiceLog, setPracticeLog] = useState<PracticeRecord[]>([]);
  const [index, setIndex] = useState(0);
  const [remaining, setRemaining] = useState(block.durationSec * 1000);
  const records = useRef<SpeedTrialRecord[]>([]);
  const onset = useRef<number | null>(null);
  const startedAt = useRef(0);
  const modalities = useRef(new Set<string>());
  const frameInterval = useRef<number | null>(null);
  const finished = useRef(false);

  const labels = (trials[0]?.response.kind === "binary" ? trials[0].response.labels : ["Yes", "No"]) as [string, string];
  const copy = COPY[block.task];

  useEffect(() => {
    measureFrameInterval(30).then((v) => (frameInterval.current = v));
  }, []);

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    const mods = [...modalities.current];
    onDone({
      task: block.task,
      durationMs: Math.min(block.durationSec * 1000, Math.round(performance.now() - startedAt.current)),
      trials: records.current,
      practice: practiceLog,
      frameIntervalMs: frameInterval.current,
      inputModality: mods.length === 0 ? "unknown" : mods.length > 1 ? "mixed" : (mods[0] as SpeedBlockResult["inputModality"]),
      interrupted: false,
    });
  }, [block, onDone, practiceLog]);

  // Block clock.
  useEffect(() => {
    if (phase !== "running") return;
    startedAt.current = performance.now();
    const id = window.setInterval(() => {
      const left = block.durationSec * 1000 - (performance.now() - startedAt.current);
      setRemaining(Math.max(0, left));
      if (left <= 0) finish();
    }, 100);
    return () => window.clearInterval(id);
  }, [phase, block.durationSec, finish]);

  // Interruption: leaving the page invalidates the block; it restarts.
  useEffect(() => {
    if (phase !== "running") return;
    const onVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      records.current = [];
      setPhase("interrupted");
      onRestart();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [phase, onRestart]);

  // Stimulus onset after paint.
  useEffect(() => {
    if (phase !== "running") return;
    onset.current = null;
    return afterNextPaint(() => {
      onset.current = performance.now();
    });
  }, [phase, index]);

  const respond = useCallback(
    (value: 0 | 1, eventTime: number, modality: string) => {
      if (phase === "practice") {
        const item = practice[pIndex];
        if (pFeedback !== null || item.response.kind !== "binary") return;
        const correct = item.response.correct === value;
        setPFeedback(correct);
        setPracticeLog((l) => [...l, { itemId: item.id, correct, rtMs: 0 }]);
        window.setTimeout(() => {
          setPFeedback(null);
          if (pIndex + 1 >= practice.length) setPhase("ready");
          else setPIndex(pIndex + 1);
        }, 900);
        return;
      }
      if (phase !== "running" || onset.current === null) return;
      const item = trials[index];
      if (!item || item.response.kind !== "binary") return;
      modalities.current.add(modality);
      records.current.push({ itemId: item.id, response: value, correct: item.response.correct === value, rtMs: Math.max(0, Math.round(eventTime - onset.current)) });
      if (index + 1 >= trials.length) finish();
      else setIndex(index + 1);
    },
    [phase, practice, pIndex, pFeedback, trials, index, finish],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
      if ((phase === "ready" || phase === "interrupted") && e.key === "Enter") {
        e.preventDefault();
        setIndex(0);
        records.current = [];
        finished.current = false;
        setPhase("running");
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "f" || e.key === "ArrowLeft") {
        e.preventDefault();
        respond(0, e.timeStamp, "keyboard");
      } else if (k === "j" || e.key === "ArrowRight") {
        e.preventDefault();
        respond(1, e.timeStamp, "keyboard");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, respond]);

  const current = phase === "practice" ? practice[pIndex] : trials[index];

  if (phase === "ready" || phase === "interrupted") {
    return (
      <div className="mx-auto w-full max-w-xl px-4 pt-6 pb-10 sm:px-8">
        <h2 className="text-lg font-medium sm:text-xl">{copy.title}</h2>
        {phase === "interrupted" && (
          <p className="mt-3 rounded-lg border border-notice-border bg-notice px-4 py-3 text-sm text-notice-foreground" role="alert">
            The task was interrupted because the page was hidden. It will start again from the beginning.
          </p>
        )}
        <p className="mt-3 leading-7 text-muted-foreground">{copy.how}</p>
        <ul className="mt-4 space-y-1.5 text-sm">
          <li>
            You have {block.durationSec} seconds. Answer as many as you can, as quickly and accurately as you can.
          </li>
          <li>
            Keys: <kbd className="rounded border px-1.5 font-mono text-xs">F</kbd> or <kbd className="rounded border px-1.5 font-mono text-xs">←</kbd> for “{labels[0]}”,{" "}
            <kbd className="rounded border px-1.5 font-mono text-xs">J</kbd> or <kbd className="rounded border px-1.5 font-mono text-xs">→</kbd> for “{labels[1]}”. Or tap the buttons.
          </li>
        </ul>
        <Button
          size="lg"
          className="mt-8 h-11"
          onClick={() => {
            setIndex(0);
            records.current = [];
            finished.current = false;
            setPhase("running");
          }}
        >
          Start the {block.durationSec}-second task
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4 pb-10 sm:px-8">
      {phase === "running" ? (
        <div className="flex items-center gap-3">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Time remaining" aria-valuemin={0} aria-valuemax={block.durationSec} aria-valuenow={Math.round(remaining / 1000)}>
            <div className="h-full bg-foreground/70" style={{ width: `${(remaining / (block.durationSec * 1000)) * 100}%` }} />
          </div>
          <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{Math.ceil(remaining / 1000)}</span>
        </div>
      ) : (
        <p className="inline-flex rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">
          Practice {pIndex + 1} of {practice.length} — not scored
        </p>
      )}
      <h2 className="mt-4 text-base font-medium sm:text-lg">{current?.prompt}</h2>
      <div className="mt-10 flex min-h-36 items-center justify-center">{current && <StimulusView item={current} glyphs={glyphs} />}</div>
      <div className="mx-auto mt-10 grid max-w-md grid-cols-2 gap-3">
        {labels.map((label, v) => (
          <Button
            key={label}
            variant="outline"
            className="h-16 text-lg"
            onPointerDown={(e) => {
              e.preventDefault();
              respond(v as 0 | 1, e.timeStamp, e.pointerType === "touch" ? "touch" : "pointer");
            }}
          >
            {label}
            <span className="ml-2 font-mono text-xs text-muted-foreground">{v === 0 ? "F" : "J"}</span>
          </Button>
        ))}
      </div>
      <p className="mt-5 h-6 text-center text-sm" role="status" aria-live="polite">
        {pFeedback === true && (
          <span className="inline-flex items-center gap-1.5">
            <Check className="size-4" aria-hidden /> Correct
          </span>
        )}
        {pFeedback === false && (
          <span className="inline-flex items-center gap-1.5">
            <X className="size-4" aria-hidden /> Not correct
          </span>
        )}
      </p>
    </div>
  );
}
