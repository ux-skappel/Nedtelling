/**
 * Test blueprints: which sections a mode contains, in what order, and how
 * each section is administered.
 *
 * Quick mode (~15–20 min) is a single adaptive fluid-reasoning section. It
 * yields one provisional Gf estimate with wide uncertainty and no profile.
 *
 * Full mode (~45–60 min) covers six CHC broad abilities. Sections alternate
 * between demanding reasoning, memory and speed tasks to spread fatigue, and
 * verbal knowledge comes last. Order effects have not been studied; a
 * validation study should counterbalance or at least fix and document order.
 */

import type { StoppingRule } from "../psychometrics/stopping";
import type { Domain, ItemFamily } from "../items/types";
import type { SpanTask } from "../items/generators/memory";

export type Mode = "quick" | "full";

interface SectionCommon {
  id: string;
  domain: Domain;
  title: string;
  /** One-sentence description shown on the section intro screen. */
  summary: string;
  instructions: string[];
  practiceItemIds: string[];
}

export interface CatSectionBlueprint extends SectionCommon {
  kind: "cat";
  families: ItemFamily[];
  /** Target share per family for content balancing (Kingsbury & Zara, 1989). */
  contentTargets: Partial<Record<ItemFamily, number>>;
  stopping: StoppingRule;
  /** Randomesque exposure control pool size. */
  randomesqueK: number;
}

export interface SpanSectionBlueprint extends SectionCommon {
  kind: "span";
  task: SpanTask;
  maxDurationSec: number;
}

export interface SpeedBlockBlueprint {
  task: "symbol-search" | "visual-comparison";
  durationSec: number;
  practiceItemIds: string[];
}

export interface SpeedSectionBlueprint extends SectionCommon {
  kind: "speed";
  baselineTrials: number;
  blocks: SpeedBlockBlueprint[];
}

export type SectionBlueprint = CatSectionBlueprint | SpanSectionBlueprint | SpeedSectionBlueprint;

export interface Blueprint {
  mode: Mode;
  version: string;
  title: string;
  description: string;
  estimatedMinutes: [number, number];
  sections: SectionBlueprint[];
}

const GF_INSTRUCTIONS = [
  "You will see three kinds of reasoning problems: pattern matrices, figure series and short logic puzzles.",
  "Each problem has exactly one best answer. Work carefully but keep moving — every problem has a generous time limit.",
  "If you are unsure, make your best guess. Problems adapt to your answers, so expect some to feel hard.",
];

export const QUICK_BLUEPRINT: Blueprint = {
  mode: "quick",
  version: "1.0.0",
  title: "Quick assessment",
  description:
    "An adaptive fluid-reasoning test of up to 22 problems. It gives a single provisional estimate with wide uncertainty — useful as a first impression, not as a profile.",
  estimatedMinutes: [15, 20],
  sections: [
    {
      kind: "cat",
      id: "gf",
      domain: "Gf",
      title: "Fluid reasoning",
      summary: "Find the rule that governs a pattern and apply it.",
      instructions: GF_INSTRUCTIONS,
      practiceItemIds: ["PR-GF-MX-001", "PR-GF-FS-001", "PR-GF-DE-001"],
      families: ["matrix", "figure-series", "deduction"],
      contentTargets: { matrix: 0.5, "figure-series": 0.25, deduction: 0.25 },
      stopping: { minItems: 12, maxItems: 22, targetSE: 0.3, maxDurationSec: 18 * 60 },
      randomesqueK: 3,
    },
  ],
};

export const FULL_BLUEPRINT: Blueprint = {
  mode: "full",
  version: "1.0.0",
  title: "Full assessment",
  description:
    "Nine short sections covering six broad cognitive abilities: fluid reasoning, working memory, visual-spatial processing, processing speed, quantitative reasoning and verbal knowledge.",
  estimatedMinutes: [45, 60],
  sections: [
    {
      kind: "cat",
      id: "gf",
      domain: "Gf",
      title: "Fluid reasoning",
      summary: "Find the rule that governs a pattern and apply it.",
      instructions: GF_INSTRUCTIONS,
      practiceItemIds: ["PR-GF-MX-001", "PR-GF-FS-001", "PR-GF-DE-001"],
      families: ["matrix", "figure-series", "deduction"],
      contentTargets: { matrix: 0.5, "figure-series": 0.25, deduction: 0.25 },
      stopping: { minItems: 8, maxItems: 13, targetSE: 0.4, maxDurationSec: 13 * 60 },
      randomesqueK: 3,
    },
    {
      kind: "span",
      id: "gwm-df",
      domain: "Gwm",
      title: "Digit memory — forward",
      summary: "Remember a sequence of digits.",
      instructions: [
        "Digits will appear one at a time in the centre of the screen.",
        "When the sequence ends, type the digits in the same order.",
        "Sequences get longer as you go. The task ends when two sequences of the same length are both recalled incorrectly.",
      ],
      practiceItemIds: ["PR-GWM-DF-001"],
      task: "digit-span-forward",
      maxDurationSec: 5 * 60,
    },
    {
      kind: "span",
      id: "gwm-db",
      domain: "Gwm",
      title: "Digit memory — backward",
      summary: "Remember a sequence of digits and reverse it.",
      instructions: [
        "Digits will appear one at a time, as before.",
        "This time, type them in reverse order: the last digit first.",
        "For example, if you see 3 8 2, type 2 8 3.",
      ],
      practiceItemIds: ["PR-GWM-DB-001"],
      task: "digit-span-backward",
      maxDurationSec: 5 * 60,
    },
    {
      kind: "cat",
      id: "gv",
      domain: "Gv",
      title: "Visual-spatial reasoning",
      summary: "Rotate shapes and fold paper in your mind.",
      instructions: [
        "You will mentally rotate flat shapes and three-dimensional objects, and imagine folding and unfolding paper.",
        "Mirror images never count as the same shape: only rotation is allowed.",
        "Each problem has one correct answer.",
      ],
      practiceItemIds: ["PR-GV-R2-001", "PR-GV-R3-001", "PR-GV-PF-001"],
      families: ["rotation-2d", "rotation-3d", "paper-folding"],
      contentTargets: { "rotation-2d": 0.35, "rotation-3d": 0.3, "paper-folding": 0.35 },
      stopping: { minItems: 6, maxItems: 10, targetSE: 0.45, maxDurationSec: 9 * 60 },
      randomesqueK: 3,
    },
    {
      kind: "speed",
      id: "gs",
      domain: "Gs",
      title: "Processing speed",
      summary: "Make simple visual judgements as quickly and accurately as you can.",
      instructions: [
        "First, a short reaction check measures how quickly your device and hand respond. Press the button (or Space) as soon as the square turns dark.",
        "Then two timed tasks follow, about one minute each. Work as fast as you can without making mistakes.",
        "Speed scores depend on the device: a phone with a touchscreen is usually slower than a keyboard. Scores from different devices should not be compared.",
      ],
      practiceItemIds: [],
      baselineTrials: 6,
      blocks: [
        {
          task: "symbol-search",
          durationSec: 60,
          practiceItemIds: ["PR-GS-SS-001", "PR-GS-SS-002", "PR-GS-SS-003", "PR-GS-SS-004"],
        },
        {
          task: "visual-comparison",
          durationSec: 60,
          practiceItemIds: ["PR-GS-VC-001", "PR-GS-VC-002", "PR-GS-VC-003", "PR-GS-VC-004"],
        },
      ],
    },
    {
      kind: "cat",
      id: "gq",
      domain: "Gq",
      title: "Quantitative reasoning",
      summary: "Find numerical patterns and relationships.",
      instructions: [
        "You will continue number sequences, complete number grids and solve balance-scale puzzles.",
        "Only whole numbers and basic arithmetic are needed. No calculator, please — scratch paper is fine.",
        "Type your answer where a box is shown; otherwise choose an option.",
      ],
      practiceItemIds: ["PR-GQ-NS-001", "PR-GQ-BA-001", "PR-GQ-NM-001"],
      families: ["number-series", "balance", "number-matrix"],
      contentTargets: { "number-series": 0.45, balance: 0.3, "number-matrix": 0.25 },
      stopping: { minItems: 6, maxItems: 10, targetSE: 0.45, maxDurationSec: 10 * 60 },
      randomesqueK: 3,
    },
    {
      kind: "span",
      id: "gwm-sr",
      domain: "Gwm",
      title: "Sequence reordering",
      summary: "Hold digits and letters in mind and put them in order.",
      instructions: [
        "A mix of digits and letters will appear one at a time.",
        "Type the digits from smallest to largest first, then the letters in alphabetical order.",
        "For example, if you see K 4 C 1, type 1 4 C K.",
      ],
      practiceItemIds: ["PR-GWM-SR-001"],
      task: "sequence-reordering",
      maxDurationSec: 5 * 60,
    },
    {
      kind: "span",
      id: "gwm-ss",
      domain: "Gwm",
      title: "Spatial memory",
      summary: "Remember the order in which blocks light up.",
      instructions: [
        "Nine blocks are shown. They will light up one at a time.",
        "When the sequence ends, tap the blocks in the same order.",
        "Sequences get longer as you go.",
      ],
      practiceItemIds: ["PR-GWM-SS-001"],
      task: "spatial-span",
      maxDurationSec: 5 * 60,
    },
    {
      kind: "cat",
      id: "gc",
      domain: "Gc",
      title: "Verbal knowledge",
      summary: "Word meanings and relationships between concepts.",
      instructions: [
        "You will answer vocabulary, analogy and odd-one-out questions in English.",
        "These questions measure acquired knowledge. They depend on language background and education, and results for non-native English speakers should be read with that in mind.",
        "Choose the single best answer.",
      ],
      practiceItemIds: ["PR-GC-VO-001", "PR-GC-AN-001", "PR-GC-CL-001"],
      families: ["vocabulary", "analogy", "classification"],
      contentTargets: { vocabulary: 0.4, analogy: 0.35, classification: 0.25 },
      stopping: { minItems: 8, maxItems: 14, targetSE: 0.4, maxDurationSec: 8 * 60 },
      randomesqueK: 3,
    },
  ],
};

export function blueprintFor(mode: Mode): Blueprint {
  return mode === "quick" ? QUICK_BLUEPRINT : FULL_BLUEPRINT;
}
