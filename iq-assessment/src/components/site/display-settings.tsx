"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export interface DisplayPrefs {
  largeText: boolean;
  highContrast: boolean;
  reducedMotion: boolean;
}

const DEFAULT_PREFS: DisplayPrefs = { largeText: false, highContrast: false, reducedMotion: false };
const KEY = "iqa:v1:display";

interface Ctx {
  prefs: DisplayPrefs;
  setPrefs: (p: DisplayPrefs) => void;
}

const DisplayContext = createContext<Ctx>({ prefs: DEFAULT_PREFS, setPrefs: () => {} });

function readPrefs(): DisplayPrefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<DisplayPrefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function applyDisplayClasses(p: DisplayPrefs) {
  const root = document.documentElement;
  root.classList.toggle("lt", p.largeText);
  root.classList.toggle("hc", p.highContrast);
  root.classList.toggle("rm", p.reducedMotion);
}

export function DisplayProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setState] = useState<DisplayPrefs>(DEFAULT_PREFS);

  useEffect(() => {
    // Read stored preferences once, after hydration (local storage is browser-only).
    const stored = readPrefs();
    applyDisplayClasses(stored);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from an external store on mount
    setState(stored);
  }, []);

  const setPrefs = useCallback((p: DisplayPrefs) => {
    setState(p);
    applyDisplayClasses(p);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(p));
    } catch {
      /* storage unavailable: preferences last for this page only */
    }
  }, []);

  const value = useMemo(() => ({ prefs, setPrefs }), [prefs, setPrefs]);
  return <DisplayContext.Provider value={value}>{children}</DisplayContext.Provider>;
}

export function useDisplayPrefs() {
  return useContext(DisplayContext);
}

const OPTIONS: { key: keyof DisplayPrefs; label: string; hint: string }[] = [
  { key: "largeText", label: "Larger text", hint: "Increases the size of all text by about 12%." },
  { key: "highContrast", label: "High contrast", hint: "Pure black on white, with thicker lines in figures." },
  { key: "reducedMotion", label: "Reduce motion", hint: "Turns off transitions and animations." },
];

export function DisplaySettingsControls() {
  const { prefs, setPrefs } = useDisplayPrefs();
  return (
    <div className="space-y-5">
      {OPTIONS.map((o) => (
        <div key={o.key} className="flex items-start justify-between gap-6">
          <div>
            <Label htmlFor={`pref-${o.key}`} className="text-sm font-medium">
              {o.label}
            </Label>
            <p className="mt-1 text-sm text-muted-foreground">{o.hint}</p>
          </div>
          <Switch
            id={`pref-${o.key}`}
            checked={prefs[o.key]}
            onCheckedChange={(v) => setPrefs({ ...prefs, [o.key]: v })}
          />
        </div>
      ))}
    </div>
  );
}

export function DisplaySettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
          <Settings2 aria-hidden />
          <span>Display</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Display settings</DialogTitle>
          <DialogDescription>These settings are stored on this device only.</DialogDescription>
        </DialogHeader>
        <DisplaySettingsControls />
      </DialogContent>
    </Dialog>
  );
}
