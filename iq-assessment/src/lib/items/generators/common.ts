import type { Rng } from "../../random";
import type { ChoiceOption, OptionContent, ResponseSpec } from "../types";

export const OPTION_IDS = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

/**
 * Build a choice response with the options in a seeded random order. The
 * key's position is therefore uniformly distributed across the bank, which
 * the validation tests check.
 */
export function choiceResponse(rng: Rng, key: OptionContent, distractors: OptionContent[]): ResponseSpec {
  const all = rng.shuffle([{ content: key, isKey: true }, ...distractors.map((d) => ({ content: d, isKey: false }))]);
  if (all.length > OPTION_IDS.length) throw new Error("Too many options");
  const options: ChoiceOption[] = all.map((o, i) => ({ id: OPTION_IDS[i], content: o.content }));
  const correctOptionId = OPTION_IDS[all.findIndex((o) => o.isKey)];
  return { kind: "choice", options, correctOptionId };
}

export function textOption(text: string): OptionContent {
  return { type: "text", text };
}

/** Generate until `make` returns a value, failing loudly after `maxTries`. */
export function retry<T>(label: string, maxTries: number, make: (attempt: number) => T | null): T {
  for (let i = 0; i < maxTries; i++) {
    const out = make(i);
    if (out !== null) return out;
  }
  throw new Error(`${label}: no valid item after ${maxTries} attempts`);
}

export function pad(n: number, width = 3): string {
  return String(n).padStart(width, "0");
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}
