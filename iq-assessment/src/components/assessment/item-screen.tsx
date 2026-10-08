"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, CornerDownLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OptionView, StimulusView, isFigureOption } from "@/components/stimuli/stimulus";
import { scoreResponse, type ChoiceOption, type Item, type ResponseValue } from "@/lib/items/types";
import { cn } from "@/lib/utils";
import { TimeBar } from "./time-bar";
import { useItemTimer } from "./use-item-timer";

export interface ItemResult {
  response: ResponseValue | null;
  rtMs: number;
  timedOut: boolean;
}

interface Props {
  item: Item;
  mode: "practice" | "test";
  optionOrder: string[] | null;
  timeLimitMs: number | null;
  initialElapsedMs: number;
  resumed: boolean;
  hidden: boolean;
  glyphs: number[][];
  onPresented?: (epochMs: number) => void;
  onHeartbeat?: (elapsedMs: number) => void;
  onSubmit: (result: ItemResult) => void;
  footer?: React.ReactNode;
}

function optionGridClass(options: ChoiceOption[]): string {
  const figural = options.some((o) => isFigureOption(o.content));
  if (!figural) return "grid-cols-1 sm:grid-cols-2";
  if (options.length === 5) return "grid-cols-3 sm:grid-cols-5";
  if (options.length <= 4) return "grid-cols-2 sm:grid-cols-4";
  return "grid-cols-4";
}

export function ItemScreen({
  item,
  mode,
  optionOrder,
  timeLimitMs,
  initialElapsedMs,
  resumed,
  hidden,
  glyphs,
  onPresented,
  onHeartbeat,
  onSubmit,
  footer,
}: Props) {
  const promptId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [numeric, setNumeric] = useState("");
  const [feedback, setFeedback] = useState<null | { correct: boolean; result: ItemResult }>(null);
  const submittedRef = useRef(false);

  const options = useMemo(() => {
    if (item.response.kind !== "choice") return [];
    const byId = new Map(item.response.options.map((o) => [o.id, o]));
    const order = optionOrder ?? item.response.options.map((o) => o.id);
    return order.map((id) => byId.get(id)!).filter(Boolean);
  }, [item, optionOrder]);

  const currentResponse = useCallback((): ResponseValue | null => {
    if (item.response.kind === "choice") return choice ? { kind: "choice", optionId: choice } : null;
    if (item.response.kind === "numeric") {
      const v = numeric.trim();
      return /^-?\d+$/.test(v) ? { kind: "numeric", value: Number(v) } : null;
    }
    return null;
  }, [item, choice, numeric]);

  const finish = useCallback(
    (result: ItemResult) => {
      if (submittedRef.current) return;
      if (mode === "practice") {
        setFeedback({ correct: scoreResponse(item, result.response), result });
        return;
      }
      submittedRef.current = true;
      onSubmit(result);
    },
    [mode, item, onSubmit],
  );

  const timer = useItemTimer({
    limitMs: mode === "practice" ? null : timeLimitMs,
    initialElapsedMs,
    hidden,
    active: true,
    onPresented,
    onHeartbeat,
    onTimeout: (elapsed) => finish({ response: currentResponse(), rtMs: elapsed, timedOut: true }),
  });

  const answered = currentResponse() !== null;
  const submit = useCallback(() => {
    if (!answered || feedback) return;
    finish({ response: currentResponse(), rtMs: timer.stop(), timedOut: false });
  }, [answered, feedback, finish, currentResponse, timer]);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [item.id]);

  // Keyboard: 1–8 choose an option, arrows move, Enter confirms.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (feedback) {
        if (e.key === "Enter") {
          e.preventDefault();
          submittedRef.current = true;
          onSubmit(feedback.result);
        }
        return;
      }
      if (e.key === "Enter") {
        if (!target || target.getAttribute("role") === "radio" || typing || target === document.body || target === headingRef.current) {
          e.preventDefault();
          submit();
        }
        return;
      }
      if (typing || options.length === 0) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= options.length) {
        e.preventDefault();
        setChoice(options[n - 1].id);
        return;
      }
      if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        const idx = choice ? options.findIndex((o) => o.id === choice) : -1;
        const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
        const next = options[(idx + delta + options.length) % options.length];
        setChoice(next.id);
        document.getElementById(`opt-${item.id}-${next.id}`)?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [options, choice, submit, feedback, onSubmit, item.id]);

  const keyId = item.response.kind === "choice" ? item.response.correctOptionId : null;
  const figural = options.some((o) => isFigureOption(o.content));

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pt-4 pb-10 sm:px-8">
      {mode === "test" && timeLimitMs !== null && <TimeBar remainingMs={timer.remainingMs ?? 0} limitMs={timeLimitMs} />}
      {mode === "practice" && (
        <p className="mb-3 inline-flex rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">Practice — not scored</p>
      )}
      {resumed && mode === "test" && (
        <p className="mb-3 text-xs text-muted-foreground">Resumed after an interruption — the remaining time carries on.</p>
      )}
      <h2 id={promptId} ref={headingRef} tabIndex={-1} className="mt-3 text-lg font-medium outline-none sm:text-xl">
        {item.prompt}
      </h2>

      <div className="mt-6 sm:mt-8">
        <StimulusView item={item} glyphs={glyphs} />
      </div>

      <div className="mt-8 sm:mt-10">
        {item.response.kind === "choice" && (
          <div
            role="radiogroup"
            aria-labelledby={promptId}
            className={cn("grid gap-2 sm:gap-3", optionGridClass(options), figural && (options.length === 5 ? "mx-auto max-w-2xl" : "mx-auto max-w-xl"))}
          >
            {options.map((o, i) => {
              const selected = choice === o.id;
              const isKey = !!feedback && o.id === keyId;
              const wrongPick = !!feedback && selected && !isKey;
              return (
                <button
                  key={o.id}
                  id={`opt-${item.id}-${o.id}`}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={figural ? `Option ${i + 1}` : undefined}
                  tabIndex={selected || (!choice && i === 0) ? 0 : -1}
                  disabled={!!feedback}
                  onClick={() => setChoice(o.id)}
                  className={cn(
                    "group relative flex items-center rounded-lg border bg-card text-left transition-[border-color,box-shadow] outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                    figural ? "aspect-square justify-center p-1.5 sm:p-2" : "min-h-12 gap-3 px-4 py-3",
                    selected && !feedback ? "border-foreground shadow-[inset_0_0_0_1.5px_var(--foreground)]" : "border-border hover:border-foreground/40",
                    isKey && "border-foreground shadow-[inset_0_0_0_2px_var(--foreground)]",
                    wrongPick && "border-dashed border-foreground/70",
                  )}
                >
                  {(isKey || wrongPick) && (
                    <span className="absolute right-1.5 bottom-1 rounded bg-card px-1 text-[10px] font-medium">
                      {isKey ? "Correct answer" : "Your answer"}
                    </span>
                  )}
                  <span
                    aria-hidden
                    className={cn(
                      "text-xs tabular-nums text-muted-foreground",
                      figural ? "absolute top-1 left-1.5" : "w-4 shrink-0",
                    )}
                  >
                    {i + 1}
                  </span>
                  <OptionView content={o.content} label={`Option ${i + 1}`} />
                </button>
              );
            })}
          </div>
        )}

        {item.response.kind === "numeric" && (
          <form
            className="mx-auto flex max-w-xs items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label htmlFor={`num-${item.id}`} className="sr-only">
              Your answer
            </label>
            <Input
              id={`num-${item.id}`}
              inputMode="numeric"
              autoComplete="off"
              pattern="-?[0-9]*"
              placeholder="Your answer"
              value={numeric}
              disabled={!!feedback}
              onChange={(e) => setNumeric(e.target.value.replace(/[^0-9-]/g, "").slice(0, 6))}
              className="h-12 text-center text-xl tabular-nums"
              autoFocus
            />
          </form>
        )}
      </div>

      {feedback ? (
        <div className="mt-8 rounded-xl border bg-card p-5" role="status" aria-live="polite">
          <p className="flex items-center gap-2 font-medium">
            {feedback.correct ? <Check className="size-4" aria-hidden /> : <X className="size-4" aria-hidden />}
            {feedback.correct ? "Correct." : "Not quite."}
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.explanation}</p>
          <div className="mt-4 flex justify-end">
            <Button
              onClick={() => {
                submittedRef.current = true;
                onSubmit(feedback.result);
              }}
            >
              Continue <CornerDownLeft aria-hidden />
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-8 flex items-center justify-between gap-4">
          <p className="hidden text-xs text-muted-foreground sm:block">
            {item.response.kind === "choice" ? `Keys 1–${options.length} to choose, Enter to confirm.` : "Type a whole number, Enter to confirm."}
          </p>
          <Button size="lg" className="ml-auto h-11 min-w-36" disabled={!answered} onClick={submit}>
            {mode === "practice" ? "Check answer" : "Next"}
            <CornerDownLeft aria-hidden />
          </Button>
        </div>
      )}
      {footer}
    </div>
  );
}
