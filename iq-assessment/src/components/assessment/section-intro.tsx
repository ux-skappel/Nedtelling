"use client";

import { useEffect, useRef } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SectionBlueprint } from "@/lib/assessment/blueprint";
import type { SectionProgress } from "@/lib/assessment/engine";

export function SectionIntro({ section, progress, onBegin }: { section: SectionBlueprint; progress: SectionProgress; onBegin: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !(e.target as HTMLElement)?.closest("button, a, input")) {
        e.preventDefault();
        onBegin();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBegin, section.id]);

  const practiceCount = section.kind === "speed" ? section.blocks.reduce((s, b) => s + b.practiceItemIds.length, 0) : section.practiceItemIds.length;

  return (
    <div className="mx-auto w-full max-w-2xl px-5 pt-10 pb-16 sm:px-8 sm:pt-16">
      <p className="eyebrow">
        Section {progress.sectionNumber} of {progress.totalSections}
      </p>
      <h1 ref={headingRef} tabIndex={-1} className="mt-3 text-3xl font-semibold outline-none sm:text-4xl">
        {section.title}
      </h1>
      <p className="mt-3 text-lg text-muted-foreground">{section.summary}</p>
      <ul className="mt-8 space-y-3 leading-7">
        {section.instructions.map((line, i) => (
          <li key={i} className="flex gap-3">
            <span aria-hidden className="mt-3 size-1.5 shrink-0 rounded-full bg-foreground/50" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
      {practiceCount > 0 && (
        <p className="mt-6 text-sm text-muted-foreground">
          You will start with {practiceCount === 1 ? "a practice question" : `${practiceCount} practice questions`}, which show whether
          you were right. After that, answers are not marked.
        </p>
      )}
      {progress.sectionNumber > 1 && (
        <p className="mt-3 text-sm text-muted-foreground">Take a short break if you need one — the clock only runs during questions.</p>
      )}
      <Button size="lg" className="mt-10 h-12 px-6 text-base" onClick={onBegin}>
        {practiceCount > 0 ? "Start practice" : "Begin"} <ArrowRight aria-hidden />
      </Button>
    </div>
  );
}
