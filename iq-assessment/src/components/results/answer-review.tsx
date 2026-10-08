"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OptionView, StimulusView, isFigureOption } from "@/components/stimuli/stimulus";
import type { ItemResponseRecord, Session } from "@/lib/assessment/session";
import { loadItemBank } from "@/lib/items/bank-client";
import { DOMAIN_LABELS, describeKey, type Item, type ItemBank, type ResponseValue } from "@/lib/items/types";
import { formatSeconds } from "@/lib/format";
import { cn } from "@/lib/utils";

function describeResponse(item: Item, r: ResponseValue | null, order: string[] | null): string {
  if (r === null) return "No answer (time ran out)";
  if (r.kind === "choice" && item.response.kind === "choice") {
    const opt = item.response.options.find((o) => o.id === r.optionId);
    const shownAt = (order ?? item.response.options.map((o) => o.id)).indexOf(r.optionId) + 1;
    return opt?.content.type === "text" ? opt.content.text : `Option ${shownAt}`;
  }
  if (r.kind === "numeric") return String(r.value);
  if (r.kind === "sequence") return r.values.join(" ");
  return String(r.kind === "binary" ? r.value : "");
}

function ReviewRow({ rec, item, glyphs }: { rec: ItemResponseRecord; item: Item; glyphs: number[][] }) {
  const [open, setOpen] = useState(false);
  const r = item.response;
  return (
    <li className="border-t first:border-t-0">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-3 py-3 text-left text-sm">
        <span className="w-6 text-xs tabular-nums text-muted-foreground">{rec.index + 1}</span>
        {rec.correct ? <Check className="size-4 shrink-0" aria-label="Correct" /> : <X className="size-4 shrink-0 text-muted-foreground" aria-label="Incorrect" />}
        <span className="flex-1 truncate">{item.prompt}</span>
        <span className="hidden text-xs text-muted-foreground sm:inline">{formatSeconds(rec.rtMs)}</span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="pb-6 pl-9">
          <StimulusView item={item} glyphs={glyphs} />
          {r.kind === "choice" && r.options.some((o) => isFigureOption(o.content)) && (
            <ol className={cn("mt-5 grid gap-2", r.options.length <= 5 ? "grid-cols-5" : "grid-cols-4 sm:grid-cols-8")}>
              {(rec.optionOrder ?? r.options.map((o) => o.id)).map((id, i) => {
                const o = r.options.find((x) => x.id === id)!;
                const mine = rec.response?.kind === "choice" && rec.response.optionId === id;
                return (
                  <li key={id} className={cn("relative aspect-square rounded-md border p-1", id === r.correctOptionId ? "border-2 border-foreground" : mine ? "border-dashed border-foreground/60" : "")}>
                    <span className="absolute top-0.5 left-1 text-[10px] text-muted-foreground">{i + 1}</span>
                    <OptionView content={o.content} label={`Option ${i + 1}${id === r.correctOptionId ? ", correct answer" : ""}${mine ? ", your answer" : ""}`} />
                  </li>
                );
              })}
            </ol>
          )}
          <dl className="mt-4 grid gap-1 text-sm">
            <div>
              <dt className="inline text-muted-foreground">Your answer: </dt>
              <dd className="inline">{describeResponse(item, rec.response, rec.optionOrder)}</dd>
            </div>
            <div>
              <dt className="inline text-muted-foreground">Correct answer: </dt>
              <dd className="inline">
                {r.kind === "choice" && isFigureOption(r.options[0].content)
                  ? `Option ${(rec.optionOrder ?? r.options.map((o) => o.id)).indexOf(r.correctOptionId) + 1} (outlined)`
                  : describeKey(item)}
              </dd>
            </div>
            <p className="mt-2 leading-6 text-muted-foreground">{item.explanation}</p>
          </dl>
        </div>
      )}
    </li>
  );
}

/**
 * Item-by-item review. Hidden behind a warning: seeing the answers makes any
 * later retest with the same question bank less accurate.
 */
export function AnswerReview({ session }: { session: Session }) {
  const [revealed, setRevealed] = useState(false);
  const [bank, setBank] = useState<ItemBank | null>(null);
  useEffect(() => {
    if (revealed && !bank) loadItemBank().then(setBank);
  }, [revealed, bank]);

  const sections = session.sections.filter((s) => s.kind === "cat" && s.responses.length > 0);
  if (sections.length === 0) return null;

  if (!revealed)
    return (
      <div className="rounded-xl border bg-card p-5 sm:p-6">
        <p className="text-sm leading-6 text-muted-foreground">
          You can review each reasoning and knowledge question with the correct answer and an explanation. Doing so will
          make any future attempt at this assessment less accurate, because you will have seen the answers.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => setRevealed(true)}>
          Show the questions and answers
        </Button>
      </div>
    );

  if (!bank) return <p className="text-sm text-muted-foreground">Loading questions…</p>;
  const byId = new Map(bank.items.map((i) => [i.id, i]));
  return (
    <div className="space-y-6">
      {sections.map((s) => {
        const responses = s.kind === "cat" ? s.responses : [];
        return (
          <section key={s.id} className="rounded-xl border bg-card px-5 sm:px-6">
            <h3 className="pt-5 pb-2 font-semibold">{DOMAIN_LABELS[responses[0].domain]}</h3>
            <ol>
              {responses.map((rec) => {
                const item = byId.get(rec.itemId);
                return item ? <ReviewRow key={rec.itemId} rec={rec} item={item} glyphs={bank.assets.glyphs} /> : null;
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
