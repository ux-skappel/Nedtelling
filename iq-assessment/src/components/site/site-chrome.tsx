import Link from "next/link";
import { DisplaySettingsButton } from "./display-settings";

export function Wordmark() {
  return (
    <Link href="/" className="group inline-flex items-baseline gap-2 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4">
      <span className="text-[1.05rem] font-semibold tracking-[-0.02em]">Tanke</span>
      <span className="hidden text-xs text-muted-foreground sm:inline">Cognitive assessment · research preview</span>
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="border-b border-border/70">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-5 sm:px-8">
        <Wordmark />
        <nav aria-label="Main" className="flex items-center gap-1 text-sm">
          <Link href="/methodology" className="rounded-md px-2.5 py-1.5 text-muted-foreground hover:text-foreground">
            Methodology
          </Link>
          <Link href="/history" className="rounded-md px-2.5 py-1.5 text-muted-foreground hover:text-foreground">
            My results
          </Link>
          <DisplaySettingsButton />
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border/70">
      <div className="mx-auto grid max-w-5xl gap-6 px-5 py-10 text-sm text-muted-foreground sm:grid-cols-[2fr_1fr] sm:px-8">
        <p className="max-w-xl leading-6">
          Tanke is a research preview of an open, browser-based cognitive assessment. Its items are original and its
          scores are provisional: they have not been calibrated or normed on a population sample, so they are not IQ
          scores and must not be used for clinical, educational or employment decisions.
        </p>
        <div className="flex flex-col gap-2 sm:items-end">
          <Link href="/methodology" className="hover:text-foreground">
            Methodology and limitations
          </Link>
          <Link href="/methodology#what-iq-measures" className="hover:text-foreground">
            What IQ tests measure
          </Link>
          <span>Data stay on this device.</span>
        </div>
      </div>
    </footer>
  );
}
