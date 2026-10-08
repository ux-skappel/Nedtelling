"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { OptionView, StimulusView, isFigureOption } from "@/components/stimuli/stimulus";
import { loadItemBank } from "@/lib/items/bank-client";
import { LEVEL_LABELS } from "@/lib/items/difficulty";
import { describeKey, ITEM_FAMILIES, type Item, type ItemBank, type ItemFamily } from "@/lib/items/types";
import { cn } from "@/lib/utils";

function ReviewCard({ item, glyphs }: { item: Item; glyphs: number[][] }) {
  const r = item.response;
  return (
    <article className="rounded-xl border bg-card p-5 sm:p-6" data-item-id={item.id}>
      <header className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono font-medium">{item.id}</span>
        <Badge variant="outline">{item.family}</Badge>
        <Badge variant="outline">
          Level {item.difficulty.level} · {LEVEL_LABELS[item.difficulty.level]}
        </Badge>
        <Badge variant="outline">a priori logit {item.difficulty.logit}</Badge>
        <Badge variant="outline">~{item.estimatedTimeSec}s</Badge>
        {item.practice && <Badge>practice</Badge>}
      </header>
      <p className="mt-4 text-sm font-medium">{item.prompt}</p>
      <div className="mt-5">
        <StimulusView item={item} glyphs={glyphs} />
      </div>
      {r.kind === "choice" && (
        <ol className={cn("mt-6 grid gap-2", r.options.some((o) => isFigureOption(o.content)) ? "grid-cols-4 sm:grid-cols-8" : "grid-cols-1 sm:grid-cols-2")}>
          {r.options.map((o, i) => (
            <li
              key={o.id}
              className={cn(
                "flex items-center gap-2 rounded-md border p-1.5",
                isFigureOption(o.content) && "aspect-square",
                o.id === r.correctOptionId ? "border-2 border-foreground" : "border-border",
              )}
            >
              {!isFigureOption(o.content) && <span className="w-5 text-xs text-muted-foreground">{i + 1}</span>}
              <OptionView content={o.content} label={`Option ${i + 1}${o.id === r.correctOptionId ? " (key)" : ""}`} />
            </li>
          ))}
        </ol>
      )}
      <dl className="mt-5 grid gap-2 text-sm">
        <div>
          <dt className="inline font-medium">Key: </dt>
          <dd className="inline">{describeKey(item)}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Explanation: </dt>
          <dd className="inline text-muted-foreground">{item.explanation}</dd>
        </div>
        <div className="font-mono text-xs text-muted-foreground">{item.rules.join(" · ")}</div>
      </dl>
    </article>
  );
}

export function ItemReview() {
  const [bank, setBank] = useState<ItemBank | null>(null);
  const [family, setFamily] = useState<ItemFamily | "all">("matrix");
  const [level, setLevel] = useState<number | "all">("all");

  useEffect(() => {
    loadItemBank().then(setBank);
  }, []);

  const items = useMemo(() => {
    if (!bank) return [];
    return bank.items
      .filter((i) => (family === "all" ? true : i.family === family))
      .filter((i) => (level === "all" ? true : i.difficulty.level === level))
      .slice(0, 120);
  }, [bank, family, level]);

  return (
    <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8">
      <p className="eyebrow">Reviewer tool</p>
      <h1 className="mt-2 text-3xl font-semibold">Item bank</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        Every item with its key, explanation, a priori difficulty and the rules it was generated from. Difficulty values
        are provisional complexity-model estimates, not calibrated parameters.
        {bank && ` Bank version ${bank.bankVersion}, ${bank.items.length} items.`}
      </p>
      <div className="mt-8 flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-2">
          Family
          <select className="rounded-md border bg-card px-2 py-1.5" value={family} onChange={(e) => setFamily(e.target.value as ItemFamily | "all")}>
            <option value="all">All</option>
            {ITEM_FAMILIES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Level
          <select className="rounded-md border bg-card px-2 py-1.5" value={level} onChange={(e) => setLevel(e.target.value === "all" ? "all" : Number(e.target.value))}>
            <option value="all">All</option>
            {[1, 2, 3, 4, 5].map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <span className="self-center text-muted-foreground">{items.length} shown</span>
      </div>
      <div className="mt-8 space-y-6">
        {!bank && <p className="text-muted-foreground">Loading item bank…</p>}
        {bank && items.map((item) => <ReviewCard key={item.id} item={item} glyphs={bank.assets.glyphs} />)}
      </div>
    </div>
  );
}
