"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Flag, LogOut } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { applyDisplayClasses, useDisplayPrefs } from "@/components/site/display-settings";
import { browserEngineContext, getRepository } from "@/lib/assessment/browser";
import {
  beginSection,
  currentView,
  endEarly,
  flagItem,
  heartbeat,
  markPresented,
  recordEvent,
  restartSpeedBlock,
  resumeSession,
  submitBaseline,
  submitItem,
  submitPractice,
  submitSpeedBlock,
  type EngineContext,
  type View,
} from "@/lib/assessment/engine";
import type { ItemFlag, Session } from "@/lib/assessment/session";
import { loadItemBank } from "@/lib/items/bank-client";
import type { ItemBank } from "@/lib/items/types";
import { ItemScreen } from "./item-screen";
import { SectionIntro } from "./section-intro";
import { SpanScreen } from "./span-screen";
import { BaselineScreen, SpeedBlockScreen } from "./speed-screens";
import { usePageHidden } from "./use-item-timer";

type LoadState = { status: "loading" } | { status: "none" } | { status: "error"; message: string } | { status: "ready" };

function ReportProblem({ onReport }: { onReport: (reason: ItemFlag["reason"], note: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ItemFlag["reason"]>("unclear");
  const [note, setNote] = useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="mt-10 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <Flag className="size-3" aria-hidden /> Report a problem with this question
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report a problem</DialogTitle>
          <DialogDescription>
            Reports are stored with your results on this device and help improve the questions. The timer keeps running.
          </DialogDescription>
        </DialogHeader>
        <RadioGroup value={reason} onValueChange={(v) => setReason(v as ItemFlag["reason"])} className="gap-3">
          {[
            ["unclear", "The question is unclear or ambiguous"],
            ["wrong-key", "I think more than one answer (or none) is correct"],
            ["display", "Something does not display properly"],
            ["other", "Something else"],
          ].map(([v, l]) => (
            <div key={v} className="flex items-center gap-2.5">
              <RadioGroupItem value={v} id={`flag-${v}`} />
              <Label htmlFor={`flag-${v}`} className="font-normal">
                {l}
              </Label>
            </div>
          ))}
        </RadioGroup>
        <textarea
          aria-label="Optional details"
          placeholder="Optional details"
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 500))}
          className="min-h-20 w-full rounded-md border bg-card px-3 py-2 text-sm"
        />
        <DialogFooter>
          <Button
            onClick={() => {
              onReport(reason, note);
              setOpen(false);
              setNote("");
            }}
          >
            Send report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TestHeader({ view, onPause, onEnd }: { view: View; onPause: () => void; onEnd: () => void }) {
  const progress = view.type === "complete" ? null : view.progress;
  const itemProgress =
    view.type === "item" && progress?.maximum ? (
      <span className="tabular-nums" data-testid="item-progress">
        Question {progress.answered + 1} <span className="text-muted-foreground">of up to {progress.maximum}</span>
      </span>
    ) : null;
  const title = view.type === "complete" ? "" : view.section.title;
  return (
    <header className="border-b border-border/70 bg-background/95">
      <div className="mx-auto flex min-h-14 max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 sm:flex-nowrap sm:px-8 sm:py-0">
        <span className="text-[1.05rem] font-semibold tracking-[-0.02em]">Tanke</span>
        {progress && (
          <div className="flex min-w-0 flex-1 items-center gap-3 text-sm">
            <span className="shrink-0 text-muted-foreground">
              {progress.sectionNumber}/{progress.totalSections}
            </span>
            <span className="truncate font-medium">{title}</span>
            {itemProgress && <span className="ml-auto hidden text-xs sm:inline">{itemProgress}</span>}
          </div>
        )}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="ml-auto gap-1.5 text-muted-foreground sm:ml-0">
              <LogOut aria-hidden /> Exit
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Leave the assessment?</AlertDialogTitle>
              <AlertDialogDescription>
                Your progress is saved. You can pause and continue later on this device, or end now and see results for the
                sections you have completed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2">
              <AlertDialogCancel>Keep going</AlertDialogCancel>
              <Button variant="outline" onClick={onPause}>
                Pause and leave
              </Button>
              <AlertDialogAction onClick={onEnd}>End and see results</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {itemProgress && <span className="order-last w-full text-xs sm:hidden">{itemProgress}</span>}
      </div>
      {progress && progress.maximum && view.type === "item" && (
        <Progress value={(progress.answered / progress.maximum) * 100} className="h-0.5 rounded-none" aria-label="Section progress" />
      )}
    </header>
  );
}

export function AssessmentRunner() {
  const router = useRouter();
  const hidden = usePageHidden();
  const { prefs } = useDisplayPrefs();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const ctxRef = useRef<EngineContext | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [env, setEnv] = useState<{ ctx: EngineContext; bank: ItemBank } | null>(null);

  const commit = useCallback((next: Session) => {
    if (next === sessionRef.current) return;
    sessionRef.current = next;
    setSession(next);
    getRepository()
      .save(next)
      .then(() => setSaveError(false))
      .catch(() => setSaveError(true));
  }, []);

  const act = useCallback(
    (fn: (s: Session, ctx: EngineContext) => Session) => {
      if (!sessionRef.current || !ctxRef.current) return;
      commit(fn(sessionRef.current, ctxRef.current));
    },
    [commit],
  );

  // Load bank and active session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const repo = getRepository();
        const id = await repo.getActiveId();
        const stored = id ? await repo.load(id) : null;
        if (!stored) {
          if (!cancelled) setLoad({ status: "none" });
          return;
        }
        const bank = await loadItemBank();
        if (stored.bankVersion !== bank.bankVersion) {
          if (!cancelled) setLoad({ status: "error", message: "This session was started with a different version of the questions and cannot be continued." });
          return;
        }
        const ctx = browserEngineContext(bank);
        ctxRef.current = ctx;
        const resumed = stored.completedAt === null && stored.events.length > 1 ? resumeSession(stored, ctx) : stored;
        if (cancelled) return;
        sessionRef.current = null;
        commit(resumed);
        setEnv({ ctx, bank });
        setLoad({ status: "ready" });
      } catch (e) {
        if (!cancelled) setLoad({ status: "error", message: e instanceof Error ? e.message : "Could not load the assessment." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [commit]);

  // Apply the session's display settings while testing; restore preferences on exit.
  useEffect(() => {
    if (!session) return;
    applyDisplayClasses({
      largeText: session.settings.largeText,
      highContrast: session.settings.highContrast,
      reducedMotion: session.settings.reducedMotion,
    });
    return () => applyDisplayClasses(prefs);
  }, [session?.settings, prefs, session]);

  // Record when the page is hidden or shown again.
  const lastHidden = useRef(false);
  useEffect(() => {
    if (load.status !== "ready" || hidden === lastHidden.current) return;
    lastHidden.current = hidden;
    act((s, ctx) => recordEvent(s, { type: hidden ? "visibility-hidden" : "visibility-visible" }, ctx));
  }, [hidden, load.status, act]);

  // Finished → results.
  useEffect(() => {
    if (session?.completedAt) {
      getRepository().setActiveId(null);
      router.replace(`/results/${session.id}`);
    }
  }, [session?.completedAt, session?.id, router]);

  if (load.status === "loading") return <p className="mx-auto max-w-2xl px-5 py-24 text-muted-foreground">Loading the assessment…</p>;
  if (load.status === "none")
    return (
      <div className="mx-auto max-w-2xl px-5 py-24 sm:px-8">
        <h1 className="text-2xl font-semibold">No assessment in progress</h1>
        <p className="mt-3 text-muted-foreground">Start a new assessment from the home page.</p>
        <Button asChild className="mt-6">
          <Link href="/">Go to the home page</Link>
        </Button>
      </div>
    );
  if (load.status === "error")
    return (
      <div className="mx-auto max-w-2xl px-5 py-24 sm:px-8">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="mt-3 text-muted-foreground">{load.message}</p>
        <Button asChild className="mt-6">
          <Link href="/">Go to the home page</Link>
        </Button>
      </div>
    );

  if (!env || !session) return null;
  const view = currentView(session, env.ctx);
  const glyphs = env.bank.assets.glyphs;

  let body: React.ReactNode = null;
  switch (view.type) {
    case "complete":
      body = <p className="mx-auto max-w-2xl px-5 py-24 text-muted-foreground">Preparing your results…</p>;
      break;
    case "section-intro":
      body = <SectionIntro key={view.section.id} section={view.section} progress={view.progress} onBegin={() => act(beginSection)} />;
      break;
    case "practice":
      body =
        view.item.response.kind === "sequence" ? (
          <SpanScreen
            key={view.item.id}
            item={view.item}
            mode="practice"
            timeLimitMs={null}
            hidden={hidden}
            onSubmit={(r) => act((x, c) => submitPractice(x, { itemId: view.item.id, response: r.response, rtMs: r.rtMs }, c))}
          />
        ) : (
          <ItemScreen
            key={view.item.id}
            item={view.item}
            mode="practice"
            optionOrder={null}
            timeLimitMs={null}
            initialElapsedMs={0}
            resumed={false}
            hidden={hidden}
            glyphs={glyphs}
            onSubmit={(r) => act((x, c) => submitPractice(x, { itemId: view.item.id, response: r.response, rtMs: r.rtMs }, c))}
          />
        );
      break;
    case "item":
      body = (
        <ItemScreen
          key={view.item.id}
          item={view.item}
          mode="test"
          optionOrder={view.current.optionOrder}
          timeLimitMs={view.timeLimitMs}
          initialElapsedMs={view.current.elapsedMs}
          resumed={view.current.resumed}
          hidden={hidden}
          glyphs={glyphs}
          onPresented={(at) => act((x) => markPresented(x, at))}
          onHeartbeat={(ms) => act((x) => heartbeat(x, ms))}
          onSubmit={(r) => act((x, c) => submitItem(x, { itemId: view.item.id, response: r.response, rtMs: r.rtMs, timedOut: r.timedOut }, c))}
          footer={<ReportProblem onReport={(reason, note) => act((x, c) => flagItem(x, { itemId: view.item.id, reason, note }, c))} />}
        />
      );
      break;
    case "span-trial":
      body = (
        <SpanScreen
          key={view.item.id}
          item={view.item}
          mode="test"
          timeLimitMs={view.timeLimitMs}
          hidden={hidden}
          onPresented={(at) => act((x) => markPresented(x, at))}
          onSubmit={(r) => act((x, c) => submitItem(x, { itemId: view.item.id, response: r.response, rtMs: r.rtMs, timedOut: r.timedOut }, c))}
        />
      );
      break;
    case "speed-baseline":
      body = <BaselineScreen trials={view.trials} onDone={(t) => act((x, c) => submitBaseline(x, t, c))} />;
      break;
    case "speed-block":
      body = (
        <SpeedBlockScreen
          key={`${view.section.id}-${view.blockIndex}`}
          block={view.block}
          trials={view.trials}
          practice={view.practice}
          glyphs={glyphs}
          onDone={(r) => act((x, c) => submitSpeedBlock(x, r, c))}
          onRestart={() => act(restartSpeedBlock)}
        />
      );
      break;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <TestHeader
        view={view}
        onPause={() => router.push("/")}
        onEnd={() => act(endEarly)}
      />
      <main id="main" className="flex-1">
        {saveError && (
          <p className="mx-auto mt-3 max-w-2xl rounded-md border border-notice-border bg-notice px-4 py-2 text-sm text-notice-foreground" role="alert">
            Your progress could not be saved on this device. You can continue, but a reload would lose your answers.
          </p>
        )}
        {body}
      </main>
    </div>
  );
}
