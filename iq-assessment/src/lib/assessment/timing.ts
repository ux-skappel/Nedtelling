/**
 * Response timing.
 *
 * Browser timing has known limits: displays refresh every ~8–17 ms, input
 * devices add their own latency, and background tabs are throttled (Bridges
 * et al., 2020; Anwyl-Irvine et al., 2021). The approach here:
 *
 *  - all intervals use the monotonic high-resolution clock
 *    (`performance.now()`), never wall-clock time;
 *  - a stimulus counts as presented on the first animation frame after it was
 *    committed to the DOM (double requestAnimationFrame), so the timer does not
 *    start before the participant could see it;
 *  - time while the page is hidden is excluded from the response time and the
 *    trial is flagged;
 *  - processing-speed scores are reported alongside a simple-reaction-time
 *    baseline from the same device, and are never compared across devices.
 */

export type Clock = () => number;

export const defaultClock: Clock = () =>
  typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();

/**
 * Measures active time on a trial. Pausing (e.g. while the page is hidden)
 * stops the clock; `initialElapsedMs` continues a trial that was interrupted.
 */
export class ResponseTimer {
  private startedAt: number | null = null;
  private accumulated: number;
  private pausedAt: number | null = null;
  private hiddenMs = 0;
  private pauses = 0;

  constructor(
    private readonly clock: Clock = defaultClock,
    initialElapsedMs = 0,
  ) {
    this.accumulated = initialElapsedMs;
  }

  get running(): boolean {
    return this.startedAt !== null && this.pausedAt === null;
  }

  start(): void {
    if (this.startedAt !== null) return;
    this.startedAt = this.clock();
  }

  pause(): void {
    if (this.startedAt === null || this.pausedAt !== null) return;
    this.pausedAt = this.clock();
    this.pauses += 1;
  }

  resume(): void {
    if (this.pausedAt === null) return;
    this.hiddenMs += this.clock() - this.pausedAt;
    this.pausedAt = null;
  }

  /** Active elapsed time so far (ms). */
  elapsed(): number {
    if (this.startedAt === null) return this.accumulated;
    const end = this.pausedAt ?? this.clock();
    return this.accumulated + (end - this.startedAt) - this.hiddenMs;
  }

  stop(): { activeMs: number; hiddenMs: number; pauses: number } {
    const activeMs = this.elapsed();
    if (this.pausedAt !== null) this.resume();
    return { activeMs: Math.max(0, activeMs), hiddenMs: this.hiddenMs, pauses: this.pauses };
  }
}

/** Run `cb` once the browser has painted the current DOM (double rAF). */
export function afterNextPaint(cb: () => void): () => void {
  if (typeof requestAnimationFrame !== "function") {
    const t = setTimeout(cb, 0);
    return () => clearTimeout(t);
  }
  let inner = 0;
  const outer = requestAnimationFrame(() => {
    inner = requestAnimationFrame(() => cb());
  });
  return () => {
    cancelAnimationFrame(outer);
    if (inner) cancelAnimationFrame(inner);
  };
}

/** Median interval between animation frames over ~`frames` frames. */
export function measureFrameInterval(frames = 30, clock: Clock = defaultClock): Promise<number | null> {
  if (typeof requestAnimationFrame !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    const stamps: number[] = [];
    const tick = () => {
      stamps.push(clock());
      if (stamps.length > frames) {
        const d = stamps.slice(1).map((t, i) => t - stamps[i]).sort((a, b) => a - b);
        resolve(d[Math.floor(d.length / 2)]);
      } else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
