/**
 * Working-memory trials (Gwm).
 *
 *  - Digit span forward / backward (Wa; backward adds manipulation, AC).
 *  - Sequence reordering: digits and letters are shown mixed; recall the
 *    digits in ascending order, then the letters alphabetically (a
 *    manipulation task in the letter–number sequencing paradigm).
 *  - Spatial span: blocks in an irregular layout light up one by one; tap
 *    them in the same order (a Corsi-type task; the layout here is original).
 *
 * Presentation is visual (one element per second) because audio cannot be
 * assumed in a browser. That is a deliberate deviation from auditory digit
 * span administration and is documented as such.
 *
 * Trials are administered with the conventional ascending-length procedure
 * with a discontinue rule (see the assessment engine), two trials per length.
 */

import type { Rng } from "../../random";
import { makeDifficulty } from "../difficulty";
import type { Item } from "../types";
import { pad, retry } from "./common";

export const MEMORY_GENERATOR = { name: "memory", version: "1.0.0" };

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
/** Consonants that are not easily confused with digits (no B/8, S/5, Z/2, G/6, O/0, I/1). */
const LETTERS = ["C", "F", "H", "J", "K", "L", "M", "N", "P", "R", "T", "X"];

/** Block centres for the spatial span task (0..100 square), deliberately irregular. */
export const SPATIAL_BLOCKS: [number, number][] = [
  [16, 18],
  [50, 10],
  [84, 22],
  [32, 42],
  [68, 40],
  [12, 68],
  [46, 70],
  [82, 64],
  [62, 90],
];

/** Avoid runs of three consecutive values (e.g. 4-5-6 or 7-6-5), which are easy to chunk. */
function hasRun(seq: number[]): boolean {
  for (let i = 2; i < seq.length; i++) {
    const d1 = seq[i - 1] - seq[i - 2];
    const d2 = seq[i] - seq[i - 1];
    if (Math.abs(d1) === 1 && d1 === d2) return true;
  }
  return false;
}

function digitSequence(len: number, rng: Rng): string[] {
  return retry("digit sequence", 1000, () => {
    const seq = rng.sample([1, 2, 3, 4, 5, 6, 7, 8, 9], len);
    return hasRun(seq) ? null : seq.map(String);
  });
}

export type SpanTask = "digit-span-forward" | "digit-span-backward" | "sequence-reordering" | "spatial-span";

const SPAN_CENTER: Record<SpanTask, number> = {
  "digit-span-forward": 6,
  "digit-span-backward": 4.5,
  "sequence-reordering": 4.5,
  "spatial-span": 5,
};

export const SPAN_LENGTHS: Record<SpanTask, [number, number]> = {
  "digit-span-forward": [3, 9],
  "digit-span-backward": [2, 8],
  "sequence-reordering": [2, 8],
  "spatial-span": [3, 9],
};

const PROMPTS: Record<SpanTask, string> = {
  "digit-span-forward": "Type the digits in the same order they were shown.",
  "digit-span-backward": "Type the digits in reverse order — last one first.",
  "sequence-reordering": "Type the digits from smallest to largest, then the letters in alphabetical order.",
  "spatial-span": "Tap the blocks in the same order they lit up.",
};

function spanItem(task: SpanTask, id: string, length: number, rng: Rng, seed: number, practice: boolean): Item {
  let sequence: string[];
  let correct: string[];
  let alphabet: string[];
  let explanation: string;
  if (task === "spatial-span") {
    const seq = rng.sample([0, 1, 2, 3, 4, 5, 6, 7, 8], length);
    sequence = seq.map(String);
    correct = sequence;
    alphabet = SPATIAL_BLOCKS.map((_, i) => String(i));
    explanation = `The blocks lit up in this order: ${seq.map((i) => i + 1).join(", ")} (numbering the blocks from the top-left).`;
  } else if (task === "sequence-reordering") {
    const nDigits = length === 2 ? 1 : rng.pick([Math.floor(length / 2), Math.ceil(length / 2)]);
    const ds = rng.sample(DIGITS, nDigits);
    const ls = rng.sample(LETTERS, length - nDigits);
    sequence = rng.shuffle([...ds, ...ls]);
    correct = [...[...ds].sort(), ...[...ls].sort()];
    alphabet = [...DIGITS, ...LETTERS];
    explanation = `Shown: ${sequence.join(" ")}. Digits in ascending order, then letters in alphabetical order: ${correct.join(" ")}.`;
  } else {
    sequence = digitSequence(length, rng);
    correct = task === "digit-span-backward" ? [...sequence].reverse() : sequence;
    alphabet = DIGITS;
    explanation =
      task === "digit-span-backward"
        ? `Shown: ${sequence.join(" ")}. In reverse order: ${correct.join(" ")}.`
        : `Shown and expected: ${sequence.join(" ")}.`;
  }
  const logit = 0.85 * (length - SPAN_CENTER[task]);
  const difficulty = makeDifficulty(`span-length@1`, logit, { task, length });
  return {
    id,
    version: 1,
    domain: "Gwm",
    narrowAbility: task === "spatial-span" ? "Wv" : task === "digit-span-forward" ? "Wa" : "AC",
    family: task,
    practice,
    prompt: PROMPTS[task],
    stimulus:
      task === "spatial-span"
        ? { type: "spatial-span", blocks: SPATIAL_BLOCKS, sequence: sequence.map(Number), presentationMs: 700, interStimulusMs: 300 }
        : { type: "span", sequence, presentationMs: 800, interStimulusMs: 200 },
    response: { kind: "sequence", correct, alphabet },
    explanation,
    rules: [`span:${task}`, `length:${length}`],
    difficulty,
    estimatedTimeSec: Math.round(length * 1 + 2 + length * 1.2),
    timeLimitSec: 20 + length * 4,
    provenance: { generator: MEMORY_GENERATOR.name, generatorVersion: MEMORY_GENERATOR.version, seed },
  };
}

const TASK_CODES: Record<SpanTask, string> = {
  "digit-span-forward": "DF",
  "digit-span-backward": "DB",
  "sequence-reordering": "SR",
  "spatial-span": "SS",
};

/**
 * Two trials per length. Ids encode task, length and trial because span
 * length is visible to the participant anyway; there is no hidden difficulty
 * to protect here.
 */
export function generateSpanTrials(task: SpanTask, seed: number, rngFactory: (s: number) => Rng): Item[] {
  const rng = rngFactory(seed);
  const [lo, hi] = SPAN_LENGTHS[task];
  const out: Item[] = [];
  for (let len = lo; len <= hi; len++) {
    for (let t = 1; t <= 2; t++) {
      out.push(spanItem(task, `GWM-${TASK_CODES[task]}-L${len}-T${t}`, len, rng, seed, false));
    }
  }
  return out;
}

export function generateSpanPractice(task: SpanTask, seed: number, rngFactory: (s: number) => Rng): Item {
  const rng = rngFactory(seed);
  return spanItem(task, `PR-GWM-${TASK_CODES[task]}-${pad(1)}`, task === "spatial-span" || task === "digit-span-forward" ? 3 : 2, rng, seed, true);
}
