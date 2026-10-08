"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useDisplayPrefs } from "@/components/site/display-settings";
import { blueprintFor, type Mode } from "@/lib/assessment/blueprint";
import { browserEngineContext, getRepository, storageIsPersistent } from "@/lib/assessment/browser";
import { createSession } from "@/lib/assessment/engine";
import type { EnvironmentInfo, ParticipantInfo } from "@/lib/assessment/session";
import { loadItemBank } from "@/lib/items/bank-client";
import { freshSeed } from "@/lib/random";

function environment(): EnvironmentInfo {
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  const fine = window.matchMedia?.("(pointer: fine)").matches;
  return {
    userAgent: navigator.userAgent,
    screenWidth: window.screen?.width ?? window.innerWidth,
    screenHeight: window.screen?.height ?? window.innerHeight,
    devicePixelRatio: window.devicePixelRatio ?? 1,
    primaryPointer: coarse ? "coarse" : fine ? "fine" : "unknown",
  };
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `s-${Date.now()}-${freshSeed()}`;
}

export function SetupForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const bp = blueprintFor(mode);
  const { prefs } = useDisplayPrefs();
  const [understood, setUnderstood] = useState(false);
  const [age, setAge] = useState("");
  const [english, setEnglish] = useState<ParticipantInfo["englishFirstLanguage"]>(null);
  const [research, setResearch] = useState(false);
  const [settings, setSettings] = useState({ largeText: false, highContrast: false, reducedMotion: false, extendedTime: false });
  const [busy, setBusy] = useState(false);
  const [persistent, setPersistent] = useState(true);
  const [smallScreen, setSmallScreen] = useState(false);
  const [hasActive, setHasActive] = useState(false);

  useEffect(() => {
    // Defaults come from the device's display preferences; read once on mount.
    /* eslint-disable react-hooks/set-state-in-effect */
    setSettings((s) => ({ ...s, ...prefs }));
    setPersistent(storageIsPersistent());
    setSmallScreen(window.innerWidth < 380);
    /* eslint-enable react-hooks/set-state-in-effect */
    getRepository()
      .getActiveId()
      .then((id) => setHasActive(!!id));
  }, [prefs]);

  const ageNum = age.trim() === "" ? null : Number(age);
  const ageInvalid = ageNum !== null && (!Number.isInteger(ageNum) || ageNum < 10 || ageNum > 110);

  async function start() {
    if (!understood || ageInvalid) return;
    setBusy(true);
    const bank = await loadItemBank();
    const ctx = browserEngineContext(bank);
    const session = createSession(
      {
        id: newId(),
        mode,
        seed: freshSeed(),
        participant: { ageYears: ageNum, englishFirstLanguage: english, researchConsent: research },
        settings,
        environment: environment(),
      },
      ctx,
    );
    const repo = getRepository();
    await repo.save(session);
    await repo.setActiveId(session.id);
    router.push("/test");
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-12 sm:px-8 sm:py-16">
      <p className="eyebrow">
        {bp.estimatedMinutes[0]}–{bp.estimatedMinutes[1]} minutes
      </p>
      <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">{bp.title}</h1>
      <p className="mt-4 text-lg leading-8 text-muted-foreground">{bp.description}</p>

      <section className="mt-10" aria-labelledby="prepare">
        <h2 id="prepare" className="text-lg font-semibold">
          Before you start
        </h2>
        <ul className="mt-4 space-y-2.5 leading-7">
          <li>Find a quiet place where you will not be interrupted for about {bp.estimatedMinutes[1]} minutes.</li>
          <li>A computer or tablet works best. A phone works, but figures are small.</li>
          <li>
            Scratch paper is fine. Please do not use a calculator, search engine or anyone&apos;s help — the results would
            then describe them, not you.
          </li>
          <li>Each question has a generous time limit. The clock only runs while a question is on screen.</li>
          <li>You can pause between questions and continue later on this device.</li>
        </ul>
        {hasActive && (
          <Alert className="mt-6">
            <AlertTitle>You already have an assessment in progress</AlertTitle>
            <AlertDescription>
              Starting a new one sets the unfinished one aside; you can still find it under “My results”.
            </AlertDescription>
          </Alert>
        )}
        {!persistent && (
          <Alert className="mt-6 border-notice-border bg-notice text-notice-foreground">
            <AlertTitle>Your browser is not saving data</AlertTitle>
            <AlertDescription className="text-notice-foreground">
              Storage appears to be blocked (for example in a private window). The assessment works, but reloading the page
              would lose your progress.
            </AlertDescription>
          </Alert>
        )}
        {smallScreen && mode === "full" && (
          <p className="mt-4 text-sm text-muted-foreground">Your screen is narrow. The visual sections are easier on a larger screen.</p>
        )}
      </section>

      <section className="mt-12" aria-labelledby="about-you">
        <h2 id="about-you" className="text-lg font-semibold">
          About you <span className="font-normal text-muted-foreground">(optional)</span>
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          These answers stay on this device. They are not used to score you today; they describe the conditions of the
          test and would be needed for age-based norms in the future.
        </p>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="age">Age in years</Label>
            <Input
              id="age"
              inputMode="numeric"
              value={age}
              onChange={(e) => setAge(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
              aria-invalid={ageInvalid || undefined}
              aria-describedby="age-hint"
              className="h-10"
            />
            <p id="age-hint" className="text-xs text-muted-foreground">
              {ageInvalid ? "Please enter a whole number of years." : ageNum !== null && ageNum < 16 ? "This assessment is designed for adults (16 and over)." : "Designed for adults, 16 and over."}
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="english">Is English your first language?</Label>
            <Select value={english ?? undefined} onValueChange={(v) => setEnglish(v as ParticipantInfo["englishFirstLanguage"])}>
              <SelectTrigger id="english" className="h-10 w-full">
                <SelectValue placeholder="Choose…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">Yes</SelectItem>
                <SelectItem value="no">No</SelectItem>
                <SelectItem value="prefer-not-to-say">Prefer not to say</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Relevant to interpreting the verbal section.</p>
          </div>
        </div>
      </section>

      <section className="mt-12" aria-labelledby="access">
        <h2 id="access" className="text-lg font-semibold">
          Accessibility
        </h2>
        <div className="mt-5 space-y-5">
          {(
            [
              ["largeText", "Larger text", "Increases text size by about 12%."],
              ["highContrast", "High contrast", "Pure black on white with thicker lines in figures."],
              ["reducedMotion", "Reduce motion", "Turns off transitions."],
              [
                "extendedTime",
                "Extended time (1.5×)",
                "A legitimate accommodation. It changes the testing conditions, so your results will be marked as non-standard.",
              ],
            ] as const
          ).map(([key, label, hint]) => (
            <div key={key} className="flex items-start justify-between gap-6">
              <div>
                <Label htmlFor={`set-${key}`}>{label}</Label>
                <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
              </div>
              <Switch id={`set-${key}`} checked={settings[key]} onCheckedChange={(v) => setSettings({ ...settings, [key]: v })} />
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12 space-y-5 rounded-xl border bg-card p-5 sm:p-6" aria-labelledby="consent">
        <h2 id="consent" className="text-lg font-semibold">
          Please confirm
        </h2>
        <div className="flex items-start gap-3">
          <Checkbox id="understood" checked={understood} onCheckedChange={(v) => setUnderstood(v === true)} className="mt-0.5" />
          <Label htmlFor="understood" className="leading-6 font-normal">
            I understand that this is a research preview. Its results are provisional, are not an IQ score and are not a
            diagnosis or a basis for any clinical, educational or employment decision.
          </Label>
        </div>
        <div className="flex items-start gap-3">
          <Checkbox id="research" checked={research} onCheckedChange={(v) => setResearch(v === true)} className="mt-0.5" />
          <Label htmlFor="research" className="leading-6 font-normal">
            Optional: include my anonymous responses when research data are exported from this device. (Nothing is ever
            uploaded automatically.)
          </Label>
        </div>
        <Button size="lg" className="mt-2 h-12 w-full text-base sm:w-auto sm:px-6" disabled={!understood || ageInvalid || busy} onClick={start}>
          {busy ? "Preparing…" : "Begin the assessment"} <ArrowRight aria-hidden />
        </Button>
      </section>
    </div>
  );
}
