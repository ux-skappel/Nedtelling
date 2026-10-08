/**
 * Dispatches an item's stimulus and option content to the right renderer.
 */

import { GLYPH_SEGMENTS } from "@/lib/items/generators/speed";
import type { BalanceSide, BalanceSymbol, Item, OptionContent, Stimulus } from "@/lib/items/types";
import { cn } from "@/lib/utils";
import { FigureSvg } from "./figure";
import { HolesSvg, PaperStepSvg, PolycubeSvg, PolyominoSvg } from "./spatial";

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function Panel({ children, className, dashed }: { children: React.ReactNode; className?: string; dashed?: boolean }) {
  return (
    <div className={cn("aspect-square rounded-md border bg-[var(--stim-paper)]", dashed ? "border-dashed border-foreground/40" : "border-foreground/15", className)}>
      {children}
    </div>
  );
}

export function BalanceIcon({ symbol, className }: { symbol: BalanceSymbol; className?: string }) {
  const common = { stroke: "var(--stim-ink)", strokeWidth: 2.2, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" className={cn("size-6", className)} aria-hidden>
      {symbol === "circle" && <circle cx="12" cy="12" r="8.5" fill="var(--stim-ink)" {...common} />}
      {symbol === "triangle" && <polygon points="12,3 21.5,20 2.5,20" fill="var(--stim-paper)" {...common} />}
      {symbol === "square" && <rect x="4" y="4" width="16" height="16" fill="var(--stim-mid)" {...common} />}
      {symbol === "diamond" && <polygon points="12,2.5 21,12 12,21.5 3,12" fill="var(--stim-light)" {...common} />}
    </svg>
  );
}

function PanItems({ side, unknown }: { side: BalanceSide | null; unknown?: BalanceSymbol }) {
  return (
    <div className="flex min-h-12 w-32 flex-wrap items-end justify-center gap-1 px-1 pb-1.5 sm:w-44">
      {side?.items.map((it, i) =>
        it.count <= 4 ? (
          Array.from({ length: it.count }, (_, k) => <BalanceIcon key={`${i}-${k}`} symbol={it.symbol} />)
        ) : (
          <span key={i} className="inline-flex items-center gap-1 font-medium tabular-nums">
            {it.count}
            <span aria-hidden>×</span>
            <BalanceIcon symbol={it.symbol} />
          </span>
        ),
      )}
      {unknown && (
        <span className="inline-flex items-center gap-1 text-lg font-semibold">
          ?<span aria-hidden>×</span>
          <BalanceIcon symbol={unknown} />
        </span>
      )}
    </div>
  );
}

function describeSide(side: BalanceSide): string {
  return side.items.map((i) => `${i.count} ${i.symbol}${i.count === 1 ? "" : "s"}`).join(" and ");
}

export function BalanceScale({ left, right, unknown, label }: { left: BalanceSide; right: BalanceSide | null; unknown?: BalanceSymbol; label: string }) {
  return (
    <figure className="flex flex-col items-center" aria-label={label} role="img">
      <div className="flex items-end">
        <PanItems side={left} />
        <div className="w-4 sm:w-8" />
        <PanItems side={right} unknown={unknown} />
      </div>
      <div className="h-0.5 w-[17rem] bg-[var(--stim-ink)] sm:w-[24rem]" />
      <svg viewBox="0 0 24 14" className="h-3.5 w-6" aria-hidden>
        <polygon points="12,0 22,14 2,14" fill="var(--stim-ink)" />
      </svg>
    </figure>
  );
}

export function GlyphSvg({ segments, className, label }: { segments: number[]; className?: string; label?: string }) {
  const p = (i: number) => [20 + (i % 3) * 30, 20 + Math.floor(i / 3) * 30];
  return (
    <svg viewBox="0 0 100 100" className={className} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {segments.map((s) => {
        const [a, b] = GLYPH_SEGMENTS[s];
        const [x1, y1] = p(a);
        const [x2, y2] = p(b);
        return <line key={s} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--stim-ink)" strokeWidth={7} strokeLinecap="round" />;
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Stimulus
// ---------------------------------------------------------------------------

export function StimulusView({ item, glyphs }: { item: Item; glyphs?: number[][] }) {
  const s: Stimulus = item.stimulus;
  switch (s.type) {
    case "matrix":
      return (
        <div className="mx-auto grid w-full max-w-[17rem] grid-cols-3 gap-1.5 sm:max-w-[25rem] sm:gap-2" role="img" aria-label="A three by three matrix of figures with the bottom-right cell missing">
          {s.cells.map((cell, i) => (
            <Panel key={i} dashed={cell === null}>
              <FigureSvg figure={cell} className="size-full" />
            </Panel>
          ))}
        </div>
      );
    case "figure-series":
      return (
        <div className="mx-auto grid w-full max-w-[38rem] grid-cols-4 gap-1.5 sm:grid-cols-7 sm:gap-2" role="img" aria-label="A series of six figures followed by a missing seventh">
          {s.panels.map((p, i) => (
            <Panel key={i}>
              <FigureSvg figure={p} className="size-full" />
            </Panel>
          ))}
          <Panel dashed>
            <FigureSvg figure={null} className="size-full" />
          </Panel>
        </div>
      );
    case "text":
      if (item.family === "classification") return null;
      if (item.family === "vocabulary")
        return <p className="text-center text-3xl font-semibold tracking-[0.06em] sm:text-4xl">{s.question}</p>;
      return (
        <div className="mx-auto max-w-xl space-y-2.5 text-[1.05rem] leading-7">
          {s.lines.map((l, i) => (
            <p key={i} className={i === 0 && s.lines.length > 2 ? "text-muted-foreground" : undefined}>
              {l}
            </p>
          ))}
        </div>
      );
    case "analogy":
      return (
        <p className="text-center text-2xl leading-relaxed sm:text-3xl">
          <span className="font-semibold">{s.a}</span>
          <span className="mx-2 text-muted-foreground">is to</span>
          <span className="font-semibold">{s.b}</span>
          <span className="mx-2 text-muted-foreground">as</span>
          <span className="font-semibold">{s.c}</span>
          <span className="mx-2 text-muted-foreground">is to</span>
          <span className="inline-block min-w-16 border-b-2 border-foreground/60 text-center text-muted-foreground">?</span>
        </p>
      );
    case "rotation-2d":
      return (
        <div className="mx-auto w-40 sm:w-48">
          <Panel>
            <PolyominoSvg cells={s.target} className="size-full" label="Target shape" />
          </Panel>
        </div>
      );
    case "rotation-3d":
      return (
        <div className="mx-auto w-44 sm:w-52">
          <Panel>
            <PolycubeSvg voxels={s.target} className="size-full" label="Target object made of cubes" />
          </Panel>
        </div>
      );
    case "paper-folding":
      return (
        <ol className="mx-auto flex max-w-xl flex-wrap justify-center gap-2 sm:gap-3" aria-label="Folding steps">
          {Array.from({ length: s.folds.length + 1 }, (_, i) => (
            <li key={i} className="w-24 sm:w-28">
              <Panel>
                <PaperStepSvg
                  folds={s.folds}
                  step={i}
                  punches={i === s.folds.length ? s.punches : undefined}
                  className="size-full"
                  label={i === s.folds.length ? "Folded paper with punched holes" : `Fold step ${i + 1}`}
                />
              </Panel>
              <p className="mt-1 text-center text-xs text-muted-foreground">{i === s.folds.length ? "Punch" : `Fold ${i + 1}`}</p>
            </li>
          ))}
        </ol>
      );
    case "number-series":
      return (
        <div className="flex flex-wrap justify-center gap-2" aria-label={`Number series: ${s.terms.join(", ")}, then a missing number`}>
          {[...s.terms.map(String), "?"].map((t, i) => (
            <span
              key={i}
              className={cn(
                "flex h-14 min-w-14 items-center justify-center rounded-md border px-3 text-xl font-semibold tabular-nums sm:h-16 sm:min-w-16 sm:text-2xl",
                t === "?" ? "border-dashed border-foreground/40 text-muted-foreground" : "border-foreground/15 bg-[var(--stim-paper)]",
              )}
            >
              {t}
            </span>
          ))}
        </div>
      );
    case "number-matrix":
      return (
        <div className="mx-auto grid w-64 grid-cols-3 gap-1.5 sm:w-72" role="table" aria-label="Number grid with one missing number">
          {s.cells.map((c, i) => (
            <span
              key={i}
              role="cell"
              className={cn(
                "flex aspect-square items-center justify-center rounded-md border text-2xl font-semibold tabular-nums",
                c === null ? "border-dashed border-foreground/40 text-muted-foreground" : "border-foreground/15 bg-[var(--stim-paper)]",
              )}
            >
              {c ?? "?"}
            </span>
          ))}
        </div>
      );
    case "balance":
      return (
        <div className="mx-auto flex max-w-xl flex-col items-center gap-7">
          {s.equations.map((e, i) => (
            <BalanceScale key={i} left={e.left} right={e.right} label={`Balanced: ${describeSide(e.left)} weigh the same as ${describeSide(e.right)}`} />
          ))}
          <div className="w-full border-t border-dashed border-border" />
          <BalanceScale left={s.query} right={null} unknown={s.unit} label={`Question: how many ${s.unit}s balance ${describeSide(s.query)}?`} />
        </div>
      );
    case "symbol-search":
      return (
        <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-8">
          <div className="flex gap-2 rounded-lg border-2 border-foreground/70 p-2">
            {s.targets.map((g, i) => (
              <GlyphSvg key={i} segments={glyphs?.[g] ?? []} className="size-14 sm:size-16" />
            ))}
          </div>
          <div className="flex gap-1.5 sm:gap-2">
            {s.group.map((g, i) => (
              <GlyphSvg key={i} segments={glyphs?.[g] ?? []} className="size-11 sm:size-14" />
            ))}
          </div>
        </div>
      );
    case "visual-comparison":
      return (
        <div className="flex flex-col items-center gap-3 font-mono text-3xl tracking-[0.18em] sm:flex-row sm:gap-10 sm:text-4xl">
          <span>{s.left}</span>
          <span className="hidden h-10 w-px bg-border sm:block" aria-hidden />
          <span>{s.right}</span>
        </div>
      );
    case "span":
      return <p className="text-center font-mono text-2xl tracking-widest">{s.sequence.join(" ")}</p>;
    case "spatial-span":
      return <p className="text-center text-sm text-muted-foreground">Blocks in order: {s.sequence.map((b) => b + 1).join(", ")}</p>;
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export function OptionView({ content, label }: { content: OptionContent; label: string }) {
  switch (content.type) {
    case "text":
      return <span className="text-base sm:text-[1.05rem]">{content.text}</span>;
    case "figure":
      return <FigureSvg figure={content.figure} className="size-full" label={label} />;
    case "polyomino":
      return <PolyominoSvg cells={content.cells} rotationDeg={content.rotationDeg} className="size-full" label={label} />;
    case "polycube":
      return <PolycubeSvg voxels={content.voxels} className="size-full" label={label} />;
    case "holes":
      return <HolesSvg holes={content.holes} className="size-full" label={label} />;
  }
}

export function isFigureOption(content: OptionContent): boolean {
  return content.type !== "text";
}
