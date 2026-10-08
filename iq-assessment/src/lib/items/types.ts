/**
 * Item bank data model.
 *
 * Every item carries: a unique id, its content version, the CHC broad and
 * narrow ability it targets, an a priori difficulty classification, a
 * machine-checkable answer key with distractors, an explanation of the
 * reasoning, an estimated completion time and generator provenance.
 *
 * Difficulty here is *a priori*: it comes from a documented complexity model
 * (see `difficulty.ts`), not from data. Empirically calibrated parameters are
 * never stored on the item; they live in a separate calibration set keyed by
 * item id and version (see `psychometrics/parameters.ts`).
 */

export const DOMAINS = ["Gf", "Gv", "Gq", "Gwm", "Gs", "Gc"] as const;
export type Domain = (typeof DOMAINS)[number];

export const DOMAIN_LABELS: Record<Domain, string> = {
  Gf: "Fluid reasoning",
  Gv: "Visual-spatial processing",
  Gq: "Quantitative reasoning",
  Gwm: "Working memory",
  Gs: "Processing speed",
  Gc: "Verbal knowledge (crystallised)",
};

/** CHC narrow abilities (Schneider & McGrew, 2018) targeted by item families. */
export type NarrowAbility =
  | "I" // Induction
  | "RG" // General sequential (deductive) reasoning
  | "RQ" // Quantitative reasoning
  | "Vz" // Visualization
  | "SR" // Speeded rotation / spatial relations
  | "Wa" // Auditory/verbal-sequential working memory capacity (here presented visually)
  | "Wv" // Visual-spatial working memory capacity
  | "AC" // Attentional control (manipulation / updating)
  | "P" // Perceptual speed
  | "VL" // Lexical knowledge
  | "LD"; // Language development

export const ITEM_FAMILIES = [
  "matrix",
  "figure-series",
  "deduction",
  "rotation-2d",
  "rotation-3d",
  "paper-folding",
  "number-series",
  "balance",
  "number-matrix",
  "digit-span-forward",
  "digit-span-backward",
  "sequence-reordering",
  "spatial-span",
  "symbol-search",
  "visual-comparison",
  "vocabulary",
  "analogy",
  "classification",
] as const;
export type ItemFamily = (typeof ITEM_FAMILIES)[number];

export type DifficultyLevel = 1 | 2 | 3 | 4 | 5;

export interface APrioriDifficulty {
  /**
   * Provisional location on an *uncalibrated* logit scale, produced by the
   * family's complexity model. Not an empirical IRT b-parameter.
   */
  logit: number;
  level: DifficultyLevel;
  /** Identifier of the complexity model that produced the estimate. */
  method: string;
  /** The item features the complexity model used. */
  features: Record<string, number | string | boolean>;
}

export interface Provenance {
  generator: string;
  generatorVersion: string;
  seed?: number;
  author?: string;
}

// ---------------------------------------------------------------------------
// Figures (matrices and figure series)
// ---------------------------------------------------------------------------

export const SHAPES = ["circle", "square", "triangle", "diamond", "pentagon", "hexagon", "star", "cross"] as const;
export type ShapeKind = (typeof SHAPES)[number] | "arrow";
export const FILLS = ["outline", "striped", "solid"] as const;
export type FillKind = (typeof FILLS)[number];

/** A group of identical shapes at the centre of a cell. */
export interface EntityLayer {
  kind: "entity";
  shape: ShapeKind;
  count: number; // 1..4
  size: number; // 0..2
  fill: FillKind;
  /** Orientation in 45° steps (0..7). Only meaningful for "arrow". */
  orientation: number;
  /** When true the renderer uses a larger base size (single-entity items). */
  large?: boolean;
}

/**
 * Line elements from a fixed vocabulary, drawn inside the cell. Used for
 * superimposition (Boolean) rules. Element ids index `LINE_ELEMENTS` in the
 * renderer; the set is stored sorted.
 */
export interface LinesLayer {
  kind: "lines";
  elements: number[];
}

/** A small marker on one of 8 positions around the cell's inner ring. */
export interface MarkerLayer {
  kind: "marker";
  position: number; // 0..7, clockwise from top
  shape: "dot" | "square";
}

export type FigureLayer = EntityLayer | LinesLayer | MarkerLayer;

export interface FigureSpec {
  layers: FigureLayer[];
}

// ---------------------------------------------------------------------------
// Stimuli
// ---------------------------------------------------------------------------

export interface MatrixStimulus {
  type: "matrix";
  /** 9 cells row-major; the last one (index 8) is the missing cell (null). */
  cells: (FigureSpec | null)[];
}

export interface FigureSeriesStimulus {
  type: "figure-series";
  panels: FigureSpec[];
}

export interface TextStimulus {
  type: "text";
  /** Lines of text shown above the question (premises, context). */
  lines: string[];
  question: string;
}

export type Cell2 = [number, number];

export interface Rotation2DStimulus {
  type: "rotation-2d";
  target: Cell2[];
}

export interface Rotation2DFigure {
  type: "polyomino";
  cells: Cell2[];
  rotationDeg: number;
}

export type Voxel = [number, number, number];

export interface Rotation3DStimulus {
  type: "rotation-3d";
  target: Voxel[];
}

export interface Rotation3DFigure {
  type: "polycube";
  voxels: Voxel[];
}

export type FoldKind = "left-over-right" | "right-over-left" | "top-over-bottom" | "bottom-over-top" | "diag-main" | "diag-anti";

export interface PaperFoldingStimulus {
  type: "paper-folding";
  folds: FoldKind[];
  /** Punch positions on the fully folded paper, in 0..1 paper coordinates. */
  punches: [number, number][];
}

export interface HolePattern {
  type: "holes";
  holes: [number, number][];
}

export interface NumberSeriesStimulus {
  type: "number-series";
  terms: number[];
}

export type BalanceSymbol = "circle" | "triangle" | "square" | "diamond";

export interface BalanceSide {
  items: { symbol: BalanceSymbol; count: number }[];
}

export interface BalanceStimulus {
  type: "balance";
  equations: { left: BalanceSide; right: BalanceSide }[];
  /** "How many {unit} balance {query}?" */
  query: BalanceSide;
  unit: BalanceSymbol;
}

export interface NumberMatrixStimulus {
  type: "number-matrix";
  /** 3×3 row-major; null marks the missing entry. */
  cells: (number | null)[];
}

export interface SpanStimulus {
  type: "span";
  /** Items shown one at a time (digits or letters). */
  sequence: string[];
  presentationMs: number;
  interStimulusMs: number;
}

export interface SpatialSpanStimulus {
  type: "spatial-span";
  /** Positions of the blocks in a 0..100 square (irregular layout). */
  blocks: [number, number][];
  /** Indices into `blocks`, in presentation order. */
  sequence: number[];
  presentationMs: number;
  interStimulusMs: number;
}

export interface SymbolSearchStimulus {
  type: "symbol-search";
  targets: number[]; // glyph ids
  group: number[]; // glyph ids
}

export interface VisualComparisonStimulus {
  type: "visual-comparison";
  left: string;
  right: string;
}

export interface AnalogyStimulus {
  type: "analogy";
  a: string;
  b: string;
  c: string;
}

export type Stimulus =
  | MatrixStimulus
  | FigureSeriesStimulus
  | TextStimulus
  | Rotation2DStimulus
  | Rotation3DStimulus
  | PaperFoldingStimulus
  | NumberSeriesStimulus
  | BalanceStimulus
  | NumberMatrixStimulus
  | SpanStimulus
  | SpatialSpanStimulus
  | SymbolSearchStimulus
  | VisualComparisonStimulus
  | AnalogyStimulus;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export type OptionContent =
  | { type: "text"; text: string }
  | { type: "figure"; figure: FigureSpec }
  | Rotation2DFigure
  | Rotation3DFigure
  | HolePattern;

export interface ChoiceOption {
  id: string;
  content: OptionContent;
}

export type ResponseSpec =
  | { kind: "choice"; options: ChoiceOption[]; correctOptionId: string }
  | { kind: "numeric"; correct: number }
  | { kind: "sequence"; correct: string[]; alphabet: string[] }
  | { kind: "binary"; labels: [string, string]; correct: 0 | 1 };

export type ResponseValue =
  | { kind: "choice"; optionId: string }
  | { kind: "numeric"; value: number }
  | { kind: "sequence"; values: string[] }
  | { kind: "binary"; value: 0 | 1 };

// ---------------------------------------------------------------------------
// Item
// ---------------------------------------------------------------------------

export interface Item {
  /** Unique, opaque id. Does not encode difficulty. */
  id: string;
  /** Content version; bump whenever anything a participant sees changes. */
  version: number;
  domain: Domain;
  narrowAbility: NarrowAbility;
  family: ItemFamily;
  /** Practice items are shown with feedback and never scored. */
  practice: boolean;
  /** The instruction shown with the item. */
  prompt: string;
  stimulus: Stimulus;
  response: ResponseSpec;
  /** Why the keyed answer is correct. Shown only after the assessment. */
  explanation: string;
  /** Machine-readable rule descriptors used by the generator and solver. */
  rules: string[];
  difficulty: APrioriDifficulty;
  /** A priori estimate of typical time on task, in seconds. */
  estimatedTimeSec: number;
  /** Hard time limit in seconds, or null for untimed items. */
  timeLimitSec: number | null;
  provenance: Provenance;
  /**
   * Structured, family-specific data that lets the test suite re-derive the
   * key independently of the generator (e.g. the logical form of a deduction
   * item). Never shown to participants.
   */
  verification?: Record<string, unknown>;
  /** SHA-256 of the canonical item content, computed when the bank is frozen. */
  contentHash?: string;
}

export interface ItemBank {
  bankVersion: string;
  /** Human-readable note on what this version contains. */
  description: string;
  /** Shared stimulus assets, frozen with the items that use them. */
  assets: {
    /** Symbol-search glyphs: each is a list of stroke ids (see GLYPH_SEGMENTS). */
    glyphs: number[][];
  };
  items: Item[];
}

export function itemKey(item: Pick<Item, "id" | "version">): string {
  return `${item.id}@${item.version}`;
}

export function numberOfOptions(item: Item): number | null {
  return item.response.kind === "choice" ? item.response.options.length : item.response.kind === "binary" ? 2 : null;
}

export function scoreResponse(item: Item, response: ResponseValue | null): boolean {
  if (response === null) return false;
  const spec = item.response;
  switch (spec.kind) {
    case "choice":
      return response.kind === "choice" && response.optionId === spec.correctOptionId;
    case "numeric":
      return response.kind === "numeric" && Number.isFinite(response.value) && response.value === spec.correct;
    case "sequence":
      return (
        response.kind === "sequence" &&
        response.values.length === spec.correct.length &&
        response.values.every((v, i) => v === spec.correct[i])
      );
    case "binary":
      return response.kind === "binary" && response.value === spec.correct;
  }
}

/** Human-readable rendering of the keyed answer (for review screens). */
export function describeKey(item: Item): string {
  const spec = item.response;
  switch (spec.kind) {
    case "choice": {
      const idx = spec.options.findIndex((o) => o.id === spec.correctOptionId);
      const opt = spec.options[idx];
      return opt.content.type === "text" ? opt.content.text : `Option ${String.fromCharCode(65 + idx)}`;
    }
    case "numeric":
      return String(spec.correct);
    case "sequence":
      return spec.correct.join(" ");
    case "binary":
      return spec.labels[spec.correct];
  }
}
