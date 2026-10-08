/**
 * Deductive reasoning generator (Gf, general sequential reasoning "RG").
 *
 * Three formats, all built from content that needs no prior knowledge:
 *
 *  - Linear ordering: comparisons between labelled objects.
 *  - Categorical syllogisms over invented nouns ("zelks", "vorps"), so that
 *    belief bias (judging conclusions by plausibility) cannot help or hurt.
 *  - Conditional reasoning about symbols on cards, including the classic
 *    invalid forms (affirming the consequent, denying the antecedent).
 *
 * Keys are proven by exhaustive model enumeration (`solvers/logic.ts`), and
 * the logical form is stored in `item.verification` so the test suite can
 * re-prove every key from scratch.
 */

import type { Rng } from "../../random";
import { estimateTime, makeDifficulty } from "../difficulty";
import type { Item, OptionContent } from "../types";
import {
  consistentOrders,
  determinedAt,
  entails,
  implies,
  mustBeAbove,
  not,
  or,
  propEntails,
  v,
  type Categorical,
  type Formula,
  type OrderPremise,
  type Quantifier,
} from "../solvers/logic";
import { choiceResponse, retry, textOption } from "./common";

export const DEDUCTION_GENERATOR = { name: "deduction", version: "1.0.0" };

// ---------------------------------------------------------------------------
// Linear ordering
// ---------------------------------------------------------------------------

interface OrderContext {
  plural: string;
  intro: (labels: string[]) => string;
  name: (label: string) => string;
  ref: (label: string) => string;
  above: string;
  below: string;
  notAbove: string;
  question: (rankWord: string) => string;
  rankWords: { top: string; bottom: string; second: string };
}

const listify = (xs: string[]) => `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
const COUNT_WORDS: Record<number, string> = { 3: "Three", 4: "Four", 5: "Five", 6: "Six" };

const ORDER_CONTEXTS: OrderContext[] = [
  {
    plural: "rods",
    intro: (l) => `${COUNT_WORDS[l.length]} rods, ${listify(l)}, are compared by length. No two rods have the same length.`,
    name: (x) => `Rod ${x}`,
    ref: (x) => `rod ${x}`,
    above: "is longer than",
    below: "is shorter than",
    notAbove: "is not longer than",
    question: (w) => `Which rod is the ${w}?`,
    rankWords: { top: "longest", bottom: "shortest", second: "second longest" },
  },
  {
    plural: "parcels",
    intro: (l) => `${COUNT_WORDS[l.length]} parcels, ${listify(l)}, are weighed. No two parcels weigh the same.`,
    name: (x) => `Parcel ${x}`,
    ref: (x) => `parcel ${x}`,
    above: "is heavier than",
    below: "is lighter than",
    notAbove: "is not heavier than",
    question: (w) => `Which parcel is the ${w}?`,
    rankWords: { top: "heaviest", bottom: "lightest", second: "second heaviest" },
  },
  {
    plural: "runners",
    intro: (l) => `${COUNT_WORDS[l.length]} runners, ${listify(l)}, finish a race. There are no ties.`,
    name: (x) => `Runner ${x}`,
    ref: (x) => `runner ${x}`,
    above: "finished ahead of",
    below: "finished behind",
    notAbove: "did not finish ahead of",
    question: (w) => `Which runner finished ${w}?`,
    rankWords: { top: "first", bottom: "last", second: "second" },
  },
];

const ORDER_LABELS = ["J", "K", "L", "M", "N", "P", "R", "T"];
const CANNOT_DETERMINE = "It cannot be determined from the statements.";

export interface OrderRecipe {
  format: "order";
  n: 3 | 4 | 5;
  question: "top" | "bottom" | "second" | "must";
  scrambled: boolean;
  mixed: boolean;
  /** Use "is not longer than" phrasing for some premises. */
  negation: boolean;
}

/** Shortest chain of stated comparisons from `from` (above) down to `to`. */
function chainBetween(premises: OrderPremise[], from: string, to: string): string[] | null {
  const queue: string[][] = [[from]];
  const seen = new Set([from]);
  while (queue.length) {
    const path = queue.shift()!;
    const last = path[path.length - 1];
    if (last === to) return path;
    for (const p of premises) {
      if (p.above === last && !seen.has(p.below)) {
        seen.add(p.below);
        queue.push([...path, p.below]);
      }
    }
  }
  return null;
}

function premiseText(ctx: OrderContext, p: OrderPremise, style: "above" | "below" | "not"): string {
  if (style === "above") return `${ctx.name(p.above)} ${ctx.above} ${ctx.ref(p.below)}.`;
  if (style === "below") return `${ctx.name(p.below)} ${ctx.below} ${ctx.ref(p.above)}.`;
  return `${ctx.name(p.below)} ${ctx.notAbove} ${ctx.ref(p.above)}.`;
}

function generateOrder(recipe: OrderRecipe, rng: Rng) {
  const ctx = rng.pick(ORDER_CONTEXTS);
  const labels = rng.sample(ORDER_LABELS, recipe.n).sort();
  const truth = rng.shuffle(labels); // index 0 = top
  let premises: OrderPremise[];
  if (recipe.question === "must") {
    // A partial order: a random spanning set of n − 1 true comparisons that
    // leaves the full order undetermined.
    const pairs: OrderPremise[] = [];
    for (let i = 0; i < truth.length; i++)
      for (let j = i + 1; j < truth.length; j++) pairs.push({ above: truth[i], below: truth[j] });
    premises = rng.sample(pairs, recipe.n - 1);
  } else {
    premises = truth.slice(0, -1).map((x, i) => ({ above: x, below: truth[i + 1] }));
  }
  if (recipe.scrambled) premises = rng.shuffle(premises);
  const orders = consistentOrders(labels, premises);

  let keyText: string;
  let distractors: string[];
  let explanation: string;
  let statements: { text: string; above: string; below: string }[] | null = null;
  let answerLabel: string | null = null;
  const statement = (p: OrderPremise) => ({
    text: `${ctx.name(p.above)} ${ctx.above} ${ctx.ref(p.below)}.`,
    above: p.above,
    below: p.below,
  });
  if (recipe.question === "must") {
    if (orders.length < 3) return null;
    const stated = new Set(premises.map((p) => `${p.above}>${p.below}`));
    const entailed: OrderPremise[] = [];
    const possible: OrderPremise[] = [];
    for (const a of labels)
      for (const b of labels) {
        if (a === b) continue;
        if (mustBeAbove(orders, a, b) && !stated.has(`${a}>${b}`)) entailed.push({ above: a, below: b });
        else if (!mustBeAbove(orders, a, b) && !mustBeAbove(orders, b, a) && a < b) possible.push({ above: a, below: b });
      }
    if (entailed.length === 0 || possible.length < 2) return null;
    const key = rng.pick(entailed);
    const definitelyFalse = premises.map((p) => ({ above: p.below, below: p.above }));
    const foils = [
      ...rng.sample(possible, 2).map((p) => (rng.bool() ? p : { above: p.below, below: p.above })),
      rng.pick(definitelyFalse),
    ];
    statements = [statement(key), ...foils.map(statement)];
    keyText = statements[0].text;
    distractors = statements.slice(1).map((st) => st.text);
    const path = chainBetween(premises, key.above, key.below);
    if (!path) return null;
    const links = path.slice(0, -1).map((x, i) => `${ctx.ref(x)} ${ctx.above} ${ctx.ref(path[i + 1])}`);
    explanation = `The statements do not fix the complete order, but they do give a chain: ${links.join(", and ")}. So "${keyText.replace(/\.$/, "")}" must be true. Each of the other statements is false in at least one order that fits everything you were told.`;
  } else {
    const pos = recipe.question === "top" ? 0 : recipe.question === "bottom" ? recipe.n - 1 : 1;
    const answer = determinedAt(orders, pos);
    if (answer === null) return null;
    answerLabel = answer;
    keyText = ctx.name(answer);
    // "Cannot be determined" is a plausible but wrong option here (the order is
    // fully determined) and keeps the guessing rate down for three-term items.
    distractors = [...labels.filter((x) => x !== answer).map((x) => ctx.name(x)), CANNOT_DETERMINE];
    const verb = ctx.plural === "runners" ? "finished" : "is the";
    explanation = `From the statements, the complete order from ${ctx.rankWords.top} to ${ctx.rankWords.bottom} is ${truth.join(", ")}. So ${ctx.ref(answer)} ${verb} ${ctx.rankWords[recipe.question]}.`;
  }

  const styles = premises.map((_, i): "above" | "below" | "not" => {
    if (recipe.negation && i % 2 === 1) return "not";
    if (recipe.mixed && rng.bool()) return "below";
    return "above";
  });
  if (recipe.mixed && !styles.includes("below") && styles.length > 1) styles[styles.findIndex((s) => s === "above")] = "below";
  const lines = [ctx.intro(labels), ...premises.map((p, i) => premiseText(ctx, p, styles[i]))];
  const question =
    recipe.question === "must" ? "Which statement must be true?" : ctx.question(ctx.rankWords[recipe.question]);
  const logit =
    -2.4 +
    0.45 * (recipe.n - 3) +
    (styles.includes("below") ? 0.25 : 0) +
    (recipe.scrambled ? 0.3 : 0) +
    (recipe.question === "second" ? 0.6 : recipe.question === "must" ? 1.2 : 0) +
    (recipe.question === "must" ? 0.5 : 0) +
    (recipe.negation ? 0.7 : 0);
  return {
    lines,
    question,
    keyText,
    distractors: distractors.slice(0, 5),
    explanation,
    logit,
    features: {
      format: "order",
      terms: recipe.n,
      question: recipe.question,
      scrambled: recipe.scrambled,
      mixedPhrasing: styles.includes("below"),
      negation: recipe.negation,
    },
    verification: { kind: "order", labels, premises, question: recipe.question, answerLabel, statements },
    rules: [`order:n${recipe.n}`, `question:${recipe.question}`],
  };
}

// ---------------------------------------------------------------------------
// Syllogisms
// ---------------------------------------------------------------------------

const NONSENSE = ["zelks", "vorps", "dulms", "nisps", "kelbs", "brasks", "mipes", "glores", "plims", "drofs", "yurls", "wosks", "fesks", "loxens"];

export interface SyllogismRecipe {
  format: "syllogism";
  premises: [Quantifier, "XY" | "YX", Quantifier, "YZ" | "ZY"];
  /** The intended valid conclusion, or "none". */
  key: [Quantifier, "XZ" | "ZX"] | "none";
}

const QTEXT: Record<Quantifier, (s: string, p: string) => string> = {
  all: (s, p) => `All ${s} are ${p}.`,
  no: (s, p) => `No ${s} are ${p}.`,
  some: (s, p) => `Some ${s} are ${p}.`,
  "some-not": (s, p) => `Some ${s} are not ${p}.`,
};

const NONE_TEXT = "None of these conclusions must be true.";

function cat(q: Quantifier, pair: string): Categorical {
  const idx = (c: string) => ({ X: 0, Y: 1, Z: 2 })[c as "X" | "Y" | "Z"] as 0 | 1 | 2;
  return { q, subject: idx(pair[0]), predicate: idx(pair[1]) };
}

const CANDIDATE_CONCLUSIONS: [Quantifier, "XZ" | "ZX"][] = [
  ["all", "XZ"],
  ["all", "ZX"],
  ["no", "XZ"],
  ["some", "XZ"],
  ["some-not", "XZ"],
  ["some-not", "ZX"],
];

function generateSyllogism(recipe: SyllogismRecipe, rng: Rng) {
  const [x, y, z] = rng.sample(NONSENSE, 3);
  const term = (c: string) => ({ X: x, Y: y, Z: z })[c as "X" | "Y" | "Z"];
  const [q1, f1, q2, f2] = recipe.premises;
  const premises = [cat(q1, f1), cat(q2, f2)];
  const valid = CANDIDATE_CONCLUSIONS.filter(([q, f]) => entails(premises, cat(q, f)));
  const invalid = CANDIDATE_CONCLUSIONS.filter(([q, f]) => !entails(premises, cat(q, f)));
  const text = ([q, f]: [Quantifier, string]) => QTEXT[q](term(f[0]), term(f[1]));
  const conclusionOf = new Map(CANDIDATE_CONCLUSIONS.map(([q, f]) => [text([q, f]), cat(q, f)] as const));

  let keyText: string;
  let distractors: string[];
  if (recipe.key === "none") {
    if (valid.length !== 0) throw new Error("Syllogism recipe expected no valid conclusion");
    keyText = NONE_TEXT;
    distractors = rng.sample(invalid, 4).map(text);
  } else {
    const [kq, kf] = recipe.key;
    if (!valid.some(([q, f]) => q === kq && f === kf)) throw new Error(`Recipe key ${kq} ${kf} is not valid`);
    keyText = text(recipe.key);
    distractors = [...rng.sample(invalid, 3).map(text), NONE_TEXT];
  }
  const lines = [
    "Assume both statements are true, and that each group mentioned has at least one member.",
    QTEXT[q1](term(f1[0]), term(f1[1])),
    QTEXT[q2](term(f2[0]), term(f2[1])),
  ];
  const nParticular = [q1, q2].filter((q) => q === "some" || q === "some-not").length;
  const nNegative = [q1, q2].filter((q) => q === "no" || q === "some-not").length;
  const canonicalFigure = f1 === "XY" && f2 === "YZ";
  const keyParticular = recipe.key !== "none" && (recipe.key[0] === "some" || recipe.key[0] === "some-not");
  const logit =
    -1.6 + 0.4 * nParticular + 0.4 * nNegative + (canonicalFigure ? 0 : 0.5) + (recipe.key === "none" ? 1.0 : 0) + (keyParticular ? 0.3 : 0);

  const explanation =
    recipe.key === "none"
      ? `The two statements can both be true in situations where any of the listed conclusions is false, so none of them is guaranteed. (For example, the ${x} that are ${y} need not overlap with the ${y} that are ${z}.)`
      : `${keyText.replace(/\.$/, "")} follows necessarily: there is no way to arrange ${x}, ${y} and ${z} that makes both statements true and this conclusion false. Each of the other conclusions fails in at least one arrangement that fits both statements.`;
  return {
    lines,
    question: "Which conclusion must be true?",
    keyText,
    distractors,
    explanation,
    logit,
    features: { format: "syllogism", mood: `${q1}/${q2}`, figure: `${f1}-${f2}`, noValid: recipe.key === "none" },
    verification: {
      kind: "syllogism",
      premises,
      options: [keyText, ...distractors].map((t) => ({ text: t, conclusion: conclusionOf.get(t) ?? null })),
    },
    rules: [`syllogism:${q1}-${f1}/${q2}-${f2}`, `conclusion:${recipe.key === "none" ? "none" : recipe.key.join("-")}`],
  };
}

// ---------------------------------------------------------------------------
// Conditionals
// ---------------------------------------------------------------------------

export type ConditionalForm = "MP" | "MT" | "DS" | "AC" | "DA" | "chainMT" | "onlyIf" | "unless";

export interface ConditionalRecipe {
  format: "conditional";
  form: ConditionalForm;
}

const SYMBOLS = ["a star", "a circle", "a triangle", "a square", "a cross"];

function generateConditional(recipe: ConditionalRecipe, rng: Rng) {
  const [p, q, r] = rng.sample(SYMBOLS, 3);
  const P = v("P");
  const Q = v("Q");
  const R = v("R");
  const has = (s: string) => `has ${s}`;
  const hasNot = (s: string) => `does not have ${s}`;
  let rules: string[];
  let fact: string;
  let premises: Formula[];
  let target: Formula;
  let targetName: string;
  let explanation: string;
  switch (recipe.form) {
    case "MP":
      rules = [`If a card has ${p}, then it also has ${q}.`];
      fact = `This card has ${p}.`;
      premises = [implies(P, Q), P];
      target = Q;
      targetName = q;
      explanation = `The rule says every card with ${p} also has ${q}. This card has ${p}, so it must have ${q}.`;
      break;
    case "DS":
      rules = [`Every card has ${p} or ${q} (or both).`];
      fact = `This card does not have ${p}.`;
      premises = [or(P, Q), not(P)];
      target = Q;
      targetName = q;
      explanation = `Every card has at least one of the two symbols. This card lacks ${p}, so it must have ${q}.`;
      break;
    case "MT":
      rules = [`If a card has ${p}, then it also has ${q}.`];
      fact = `This card does not have ${q}.`;
      premises = [implies(P, Q), not(Q)];
      target = P;
      targetName = p;
      explanation = `If the card had ${p}, the rule would require it to have ${q}. It has no ${q.replace(/^an? /, "")}, so it cannot have ${p}.`;
      break;
    case "AC":
      rules = [`If a card has ${p}, then it also has ${q}.`];
      fact = `This card has ${q}.`;
      premises = [implies(P, Q), Q];
      target = P;
      targetName = p;
      explanation = `The rule only says what happens when a card has ${p}. A card with ${q} may or may not have ${p}, so it cannot be determined. (Concluding that it has ${p} is the error of "affirming the consequent".)`;
      break;
    case "DA":
      rules = [`If a card has ${p}, then it also has ${q}.`];
      fact = `This card does not have ${p}.`;
      premises = [implies(P, Q), not(P)];
      target = Q;
      targetName = q;
      explanation = `The rule says nothing about cards without ${p}; such a card may or may not have ${q}. (Concluding that it has no ${q.replace(/^an? /, "")} is the error of "denying the antecedent".)`;
      break;
    case "chainMT":
      rules = [`If a card has ${p}, then it also has ${q}.`, `If a card has ${q}, then it also has ${r}.`];
      fact = `This card does not have ${r}.`;
      premises = [implies(P, Q), implies(Q, R), not(R)];
      target = P;
      targetName = p;
      explanation = `Without ${r} the card cannot have ${q} (second rule), and without ${q} it cannot have ${p} (first rule). So it does not have ${p}.`;
      break;
    case "onlyIf":
      rules = [`A card has ${p} only if it has ${q}.`];
      fact = `This card does not have ${q}.`;
      premises = [implies(P, Q), not(Q)];
      target = P;
      targetName = p;
      explanation = `"A card has ${p} only if it has ${q}" means every card with ${p} has ${q}. This card has no ${q.replace(/^an? /, "")}, so it cannot have ${p}.`;
      break;
    case "unless":
      rules = [`A card has ${p} unless it has ${q}.`];
      fact = `This card does not have ${p}.`;
      premises = [implies(not(Q), P), not(P)];
      target = Q;
      targetName = q;
      explanation = `"A card has ${p} unless it has ${q}" means any card without ${q} has ${p}. This card has no ${p.replace(/^an? /, "")}, so it must have ${q}.`;
      break;
  }
  const yes = propEntails(premises, target);
  const no = propEntails(premises, not(target));
  const options = {
    yes: `It ${has(targetName)}.`,
    no: `It ${hasNot(targetName)}.`,
    unknown: `It cannot be determined whether it has ${targetName}.`,
    breaks: "The card breaks the rule.",
  };
  const keyText = yes ? options.yes : no ? options.no : options.unknown;
  const distractors = Object.values(options).filter((o) => o !== keyText);
  const weights: Record<ConditionalForm, number> = {
    MP: -2.0,
    DS: -1.2,
    MT: -0.3,
    DA: 0.4,
    AC: 0.6,
    chainMT: 0.7,
    onlyIf: 0.8,
    unless: 1.2,
  };
  return {
    lines: ["Every card in a deck follows the rule below.", ...rules, `You are shown a card. ${fact}`],
    question: "What follows about this card?",
    keyText,
    distractors,
    explanation,
    logit: weights[recipe.form],
    features: { format: "conditional", form: recipe.form },
    verification: {
      kind: "conditional",
      premises,
      target,
      options: [
        { text: options.yes, meaning: "yes" },
        { text: options.no, meaning: "no" },
        { text: options.unknown, meaning: "unknown" },
        { text: options.breaks, meaning: "breaks" },
      ],
    },
    rules: [`conditional:${recipe.form}`],
  };
}

// ---------------------------------------------------------------------------

export type DeductionRecipe = OrderRecipe | SyllogismRecipe | ConditionalRecipe;

export function generateDeductionItem(recipe: DeductionRecipe, id: string, seed: number, rngFactory: (s: number) => Rng): Item {
  const rng = rngFactory(seed);
  const built = retry(`deduction ${id}`, 500, () => {
    if (recipe.format === "order") return generateOrder(recipe, rng);
    if (recipe.format === "syllogism") return generateSyllogism(recipe, rng);
    return generateConditional(recipe, rng);
  });
  const response = choiceResponse(rng, textOption(built.keyText), built.distractors.map(textOption) as OptionContent[]);
  const difficulty = makeDifficulty("deduction-complexity@1", built.logit, built.features);
  const verification = built.verification as unknown as Record<string, unknown>;
  return {
    id,
    version: 1,
    domain: "Gf",
    narrowAbility: "RG",
    family: "deduction",
    practice: false,
    prompt: built.question,
    stimulus: { type: "text", lines: built.lines, question: built.question },
    response,
    explanation: built.explanation,
    rules: built.rules,
    difficulty,
    estimatedTimeSec: estimateTime(50, difficulty.level),
    timeLimitSec: 150,
    provenance: { generator: DEDUCTION_GENERATOR.name, generatorVersion: DEDUCTION_GENERATOR.version, seed },
    verification,
  };
}

export const DEDUCTION_PLAN: DeductionRecipe[] = [
  { format: "order", n: 3, question: "top", scrambled: false, mixed: false, negation: false },
  { format: "order", n: 4, question: "bottom", scrambled: true, mixed: true, negation: false },
  { format: "order", n: 5, question: "second", scrambled: true, mixed: true, negation: false },
  { format: "order", n: 4, question: "second", scrambled: true, mixed: false, negation: false },
  { format: "order", n: 5, question: "must", scrambled: true, mixed: true, negation: false },
  { format: "order", n: 5, question: "must", scrambled: true, mixed: false, negation: true },
  { format: "syllogism", premises: ["all", "XY", "all", "YZ"], key: ["all", "XZ"] },
  { format: "syllogism", premises: ["all", "XY", "no", "YZ"], key: ["no", "XZ"] },
  { format: "syllogism", premises: ["some", "XY", "all", "YZ"], key: ["some", "XZ"] },
  { format: "syllogism", premises: ["all", "XY", "some-not", "ZY"], key: ["some-not", "ZX"] },
  { format: "syllogism", premises: ["some", "XY", "some", "YZ"], key: "none" },
  { format: "conditional", form: "MP" },
  { format: "conditional", form: "DS" },
  { format: "conditional", form: "MT" },
  { format: "conditional", form: "AC" },
  { format: "conditional", form: "chainMT" },
  { format: "conditional", form: "unless" },
];
