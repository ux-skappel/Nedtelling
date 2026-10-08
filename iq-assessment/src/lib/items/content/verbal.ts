/**
 * Crystallised-ability items (Gc): vocabulary, verbal analogies and
 * conceptual classification. Written by hand for this project.
 *
 * These items measure acquired knowledge of English. They are inherently
 * dependent on language, education and culture, and results for people who
 * are not native English speakers, or who were educated in another language,
 * should not be interpreted as a measure of their reasoning ability. The
 * results page says so explicitly.
 *
 * Difficulty is an expert rating informed by how common the words are (word
 * frequency is a well-established predictor of vocabulary item difficulty)
 * and how abstract the relation is. No corpus counts were used, so the rating
 * is provisional like every other a priori difficulty in this bank.
 *
 * Unlike the generated families, verbal keys cannot be machine-proven. The
 * test suite checks structure (one key among unique options, explanation
 * present, key not duplicated); semantic soundness needs expert review and,
 * eventually, pilot item statistics (a negative item-total correlation is the
 * classic signature of a miskeyed or ambiguous verbal item).
 */

import { makeDifficulty } from "../difficulty";
import type { DifficultyLevel, Item, ItemFamily } from "../types";

interface VerbalSpec {
  level: DifficultyLevel;
  /** Stem: the word (vocabulary), [a, b, c] (analogy) or null (classification). */
  stem: string | [string, string, string] | null;
  key: string;
  distractors: string[];
  explanation: string;
  /** Rough frequency band of the critical word(s) or relation type. */
  feature: string;
}

const LEVEL_LOGIT: Record<DifficultyLevel, number> = { 1: -2, 2: -1, 3: 0, 4: 1, 5: 2 };

export const VOCABULARY: VerbalSpec[] = [
  { level: 1, stem: "begin", key: "start", distractors: ["finish", "carry", "listen", "borrow"], explanation: "To begin something is to start it.", feature: "very common" },
  { level: 1, stem: "rapid", key: "fast", distractors: ["heavy", "quiet", "bright", "narrow"], explanation: "Rapid means happening or moving quickly: fast.", feature: "very common" },
  { level: 1, stem: "assist", key: "help", distractors: ["order", "watch", "follow", "refuse"], explanation: "To assist someone is to help them.", feature: "very common" },
  { level: 1, stem: "fragile", key: "delicate", distractors: ["heavy", "sharp", "sticky", "plain"], explanation: "Something fragile is easily broken or damaged: delicate.", feature: "common" },
  { level: 1, stem: "abundant", key: "plentiful", distractors: ["scarce", "distant", "noisy", "expensive"], explanation: "Abundant means existing in large quantities: plentiful. (Scarce is its opposite.)", feature: "common" },
  { level: 2, stem: "candid", key: "frank", distractors: ["sweet", "hidden", "careful", "brilliant"], explanation: "A candid remark is open and honest: frank.", feature: "moderately common" },
  { level: 2, stem: "diligent", key: "hardworking", distractors: ["clever", "wealthy", "anxious", "generous"], explanation: "Someone diligent works carefully and steadily: hardworking.", feature: "moderately common" },
  { level: 2, stem: "obsolete", key: "outdated", distractors: ["hidden", "obvious", "enormous", "fragile"], explanation: "Something obsolete is no longer used because it has been replaced: outdated.", feature: "moderately common" },
  { level: 2, stem: "trivial", key: "unimportant", distractors: ["complicated", "triangular", "dangerous", "secret"], explanation: "A trivial matter is of little importance.", feature: "moderately common" },
  { level: 2, stem: "verbose", key: "wordy", distractors: ["angry", "honest", "silent", "precise"], explanation: "Verbose means using more words than needed: wordy.", feature: "moderately common" },
  { level: 2, stem: "revere", key: "admire", distractors: ["return", "doubt", "repeat", "ignore"], explanation: "To revere someone is to respect and admire them deeply.", feature: "moderately common" },
  { level: 3, stem: "ephemeral", key: "short-lived", distractors: ["spiritual", "endless", "colourful", "invisible"], explanation: "Ephemeral means lasting for a very short time.", feature: "uncommon" },
  { level: 3, stem: "meticulous", key: "painstaking", distractors: ["nervous", "generous", "hasty", "decorative"], explanation: "A meticulous person pays great attention to detail: painstaking.", feature: "uncommon" },
  { level: 3, stem: "laconic", key: "terse", distractors: ["sleepy", "wealthy", "cheerful", "clumsy"], explanation: "Laconic means using very few words: terse.", feature: "uncommon" },
  { level: 3, stem: "ameliorate", key: "improve", distractors: ["worsen", "measure", "delay", "decorate"], explanation: "To ameliorate a situation is to make it better: improve.", feature: "uncommon" },
  { level: 3, stem: "gregarious", key: "sociable", distractors: ["greedy", "serious", "generous", "timid"], explanation: "A gregarious person enjoys company: sociable.", feature: "uncommon" },
  { level: 3, stem: "innocuous", key: "harmless", distractors: ["poisonous", "invisible", "numerous", "careless"], explanation: "Something innocuous causes no harm or offence: harmless.", feature: "uncommon" },
  { level: 3, stem: "sanguine", key: "optimistic", distractors: ["gloomy", "cautious", "sacred", "careless"], explanation: "Sanguine means hopeful about the future: optimistic.", feature: "uncommon" },
  { level: 4, stem: "perfunctory", key: "cursory", distractors: ["perfect", "essential", "fragrant", "punctual"], explanation: "A perfunctory action is done with minimal effort or attention: cursory.", feature: "rare" },
  { level: 4, stem: "obsequious", key: "servile", distractors: ["obvious", "stubborn", "mysterious", "mournful"], explanation: "Obsequious means excessively eager to please or obey: servile.", feature: "rare" },
  { level: 4, stem: "recondite", key: "obscure", distractors: ["repaired", "recent", "obvious", "reconciled"], explanation: "Recondite knowledge is little known and hard to understand: obscure.", feature: "rare" },
  { level: 4, stem: "impecunious", key: "penniless", distractors: ["impatient", "spotless", "careless", "imprudent"], explanation: "Impecunious means having little or no money: penniless.", feature: "rare" },
  { level: 4, stem: "truculent", key: "aggressive", distractors: ["sluggish", "truthful", "transparent", "generous"], explanation: "A truculent person is quick to argue or fight: aggressive.", feature: "rare" },
  { level: 4, stem: "equanimity", key: "composure", distractors: ["fairness", "hostility", "enthusiasm", "symmetry"], explanation: "Equanimity is mental calmness, especially under pressure: composure. (It is not about equality or fairness.)", feature: "rare" },
  { level: 5, stem: "pulchritude", key: "beauty", distractors: ["decay", "strength", "wealth", "anger"], explanation: "Pulchritude is a literary word for physical beauty.", feature: "very rare" },
  { level: 5, stem: "pusillanimous", key: "cowardly", distractors: ["childish", "generous", "unanimous", "tiny"], explanation: "Pusillanimous means lacking courage: cowardly.", feature: "very rare" },
  { level: 5, stem: "tenebrous", key: "dark", distractors: ["tender", "stubborn", "fragile", "sticky"], explanation: "Tenebrous is a literary word meaning dark or shadowy.", feature: "very rare" },
  { level: 5, stem: "apothegm", key: "maxim", distractors: ["medicine", "prayer", "summit", "insult"], explanation: "An apothegm is a short, pithy saying expressing a general truth: a maxim.", feature: "very rare" },
];

export const ANALOGIES: VerbalSpec[] = [
  { level: 1, stem: ["hand", "glove", "foot"], key: "sock", distractors: ["toe", "leg", "walk", "ankle"], explanation: "A glove is worn on the hand; a sock is worn on the foot.", feature: "worn-on" },
  { level: 1, stem: ["bird", "nest", "bee"], key: "hive", distractors: ["honey", "flower", "sting", "wing"], explanation: "A bird lives in a nest; a bee lives in a hive.", feature: "dwelling" },
  { level: 1, stem: ["hot", "cold", "up"], key: "down", distractors: ["high", "over", "top", "sky"], explanation: "Hot and cold are opposites, as are up and down.", feature: "antonym" },
  { level: 1, stem: ["puppy", "dog", "kitten"], key: "cat", distractors: ["mouse", "milk", "fur", "young"], explanation: "A puppy is a young dog; a kitten is a young cat.", feature: "young-adult" },
  { level: 2, stem: ["painter", "brush", "writer"], key: "pen", distractors: ["book", "story", "paper", "reader"], explanation: "A brush is the tool a painter works with; a pen is the tool a writer works with. (Paper corresponds to the canvas, not the brush.)", feature: "tool" },
  { level: 2, stem: ["thermometer", "temperature", "scale"], key: "weight", distractors: ["music", "fish", "distance", "size"], explanation: "A thermometer measures temperature; a scale measures weight.", feature: "measures" },
  { level: 2, stem: ["book", "chapter", "building"], key: "floor", distractors: ["architect", "street", "rent", "height"], explanation: "A book is divided into chapters; a building is divided into floors.", feature: "division" },
  { level: 2, stem: ["drought", "rain", "famine"], key: "food", distractors: ["hunger", "desert", "illness", "winter"], explanation: "A drought is a severe lack of rain; a famine is a severe lack of food.", feature: "lack-of" },
  { level: 2, stem: ["carpenter", "wood", "potter"], key: "clay", distractors: ["wheel", "vase", "kiln", "glaze"], explanation: "A carpenter shapes wood; a potter shapes clay. (The wheel and kiln are tools; the vase is a product.)", feature: "material" },
  { level: 3, stem: ["oasis", "desert", "island"], key: "ocean", distractors: ["palm", "sand", "beach", "ship"], explanation: "An oasis is an isolated patch of fertile land surrounded by desert; an island is land surrounded by water such as an ocean.", feature: "surrounded-by" },
  { level: 3, stem: ["muffle", "sound", "dim"], key: "light", distractors: ["dark", "lamp", "shadow", "room"], explanation: "To muffle a sound is to make it less loud; to dim a light is to make it less bright.", feature: "reduce" },
  { level: 3, stem: ["novice", "expert", "seed"], key: "tree", distractors: ["soil", "garden", "water", "root"], explanation: "A novice develops into an expert; a seed develops into a tree.", feature: "develops-into" },
  { level: 3, stem: ["tadpole", "frog", "caterpillar"], key: "butterfly", distractors: ["leaf", "cocoon", "worm", "wing"], explanation: "A tadpole becomes a frog; a caterpillar becomes a butterfly. (The cocoon is an intermediate stage, not the adult.)", feature: "becomes" },
  { level: 3, stem: ["sculptor", "chisel", "surgeon"], key: "scalpel", distractors: ["patient", "hospital", "operation", "nurse"], explanation: "A chisel is a sculptor's cutting tool; a scalpel is a surgeon's cutting tool.", feature: "tool" },
  { level: 3, stem: ["ignite", "extinguish", "assemble"], key: "dismantle", distractors: ["build", "collect", "construct", "meet"], explanation: "Ignite and extinguish are opposites, as are assemble and dismantle.", feature: "antonym" },
  { level: 3, stem: ["letter", "word", "note"], key: "melody", distractors: ["piano", "sound", "staff", "rhythm"], explanation: "Letters are combined to form words; notes are combined to form melodies.", feature: "composes" },
  { level: 3, stem: ["myopia", "vision", "deafness"], key: "hearing", distractors: ["ear", "sound", "music", "silence"], explanation: "Myopia is an impairment of vision; deafness is an impairment of hearing.", feature: "impairment-of" },
  { level: 4, stem: ["laconic", "words", "frugal"], key: "money", distractors: ["poverty", "charity", "greed", "bank"], explanation: "A laconic person is sparing with words; a frugal person is sparing with money.", feature: "sparing-with" },
  { level: 4, stem: ["ravenous", "hungry", "exhausted"], key: "tired", distractors: ["sleepy", "energetic", "bored", "rested"], explanation: "Ravenous is an extreme degree of hungry; exhausted is an extreme degree of tired.", feature: "degree" },
  { level: 4, stem: ["cartographer", "maps", "lexicographer"], key: "dictionaries", distractors: ["letters", "languages", "laws", "lectures"], explanation: "A cartographer compiles maps; a lexicographer compiles dictionaries.", feature: "produces" },
  { level: 4, stem: ["prologue", "epilogue", "overture"], key: "finale", distractors: ["opera", "symphony", "encore", "intermission"], explanation: "A prologue opens a literary work and an epilogue closes it; an overture opens a musical work and a finale closes it.", feature: "opening-closing" },
  { level: 4, stem: ["mendacious", "truth", "callous"], key: "sympathy", distractors: ["cruelty", "skin", "pain", "anger"], explanation: "A mendacious person lacks truthfulness; a callous person lacks sympathy.", feature: "lacking" },
  { level: 4, stem: ["soluble", "dissolve", "malleable"], key: "shape", distractors: ["metal", "melt", "break", "harden"], explanation: "Something soluble can be dissolved; something malleable can be shaped.", feature: "can-be" },
  { level: 5, stem: ["pithy", "verbose", "transient"], key: "permanent", distractors: ["fleeting", "brief", "travelling", "temporary"], explanation: "Pithy and verbose are opposites; so are transient and permanent. (The other options are near-synonyms of transient.)", feature: "antonym-abstract" },
  { level: 5, stem: ["bellicose", "war", "litigious"], key: "lawsuits", distractors: ["lawyers", "peace", "judges", "laws"], explanation: "A bellicose person is inclined to start wars or fights; a litigious person is inclined to start lawsuits.", feature: "inclined-to" },
  { level: 5, stem: ["iconoclast", "tradition", "heretic"], key: "orthodoxy", distractors: ["priest", "punishment", "conversion", "sermon"], explanation: "An iconoclast attacks cherished traditions; a heretic rejects established religious orthodoxy.", feature: "opposes" },
];

export const CLASSIFICATION: VerbalSpec[] = [
  { level: 1, stem: null, key: "carrot", distractors: ["apple", "banana", "cherry", "grape"], explanation: "All the others are fruits; a carrot is a root vegetable.", feature: "category" },
  { level: 1, stem: null, key: "blanket", distractors: ["hammer", "saw", "screwdriver", "pliers"], explanation: "All the others are hand tools.", feature: "category" },
  { level: 1, stem: null, key: "circle", distractors: ["red", "blue", "green", "yellow"], explanation: "All the others are colours; a circle is a shape.", feature: "category" },
  { level: 2, stem: null, key: "trumpet", distractors: ["violin", "cello", "harp", "guitar"], explanation: "All the others are string instruments; the trumpet is a brass instrument.", feature: "subcategory" },
  { level: 2, stem: null, key: "shark", distractors: ["whale", "dolphin", "seal", "walrus"], explanation: "All the others are mammals; a shark is a fish.", feature: "subcategory" },
  { level: 2, stem: null, key: "Sirius", distractors: ["Mars", "Venus", "Jupiter", "Saturn"], explanation: "All the others are planets of our solar system; Sirius is a star.", feature: "subcategory" },
  { level: 3, stem: null, key: "hasten", distractors: ["ponder", "contemplate", "reflect", "muse"], explanation: "All the others mean to think carefully; to hasten is to hurry.", feature: "meaning" },
  { level: 3, stem: null, key: "triangle", distractors: ["square", "rectangle", "rhombus", "trapezium"], explanation: "All the others are four-sided shapes (quadrilaterals); a triangle has three sides.", feature: "property" },
  { level: 3, stem: null, key: "pound", distractors: ["inch", "mile", "yard", "foot"], explanation: "All the others are units of length; a pound is a unit of weight.", feature: "property" },
  { level: 3, stem: null, key: "granite", distractors: ["copper", "iron", "zinc", "tin"], explanation: "All the others are metals; granite is a rock.", feature: "subcategory" },
  { level: 3, stem: null, key: "novel", distractors: ["atlas", "almanac", "encyclopedia", "dictionary"], explanation: "All the others are reference works; a novel is fiction.", feature: "function" },
  { level: 4, stem: null, key: "parsimonious", distractors: ["benevolent", "magnanimous", "altruistic", "philanthropic"], explanation: "All the others describe generosity; parsimonious means stingy.", feature: "meaning" },
  { level: 4, stem: null, key: "novella", distractors: ["sonnet", "haiku", "limerick", "ode"], explanation: "All the others are forms of poetry; a novella is a work of prose fiction.", feature: "subcategory" },
  { level: 4, stem: null, key: "adversary", distractors: ["sycophant", "toady", "flatterer", "lackey"], explanation: "All the others are people who fawn on someone to gain favour; an adversary is an opponent.", feature: "meaning" },
  { level: 5, stem: null, key: "elucidate", distractors: ["obfuscate", "obscure", "cloud", "muddle"], explanation: "All the others mean to make something less clear; to elucidate is to make it clearer.", feature: "meaning" },
  { level: 5, stem: null, key: "vermilion", distractors: ["cerulean", "azure", "cobalt", "sapphire"], explanation: "All the others are shades of blue; vermilion is a bright red.", feature: "fine category" },
];

export const VERBAL_PRACTICE: { family: ItemFamily; spec: VerbalSpec }[] = [
  { family: "vocabulary", spec: { level: 1, stem: "large", key: "big", distractors: ["small", "quick", "loud", "soft"], explanation: "Large and big mean the same.", feature: "very common" } },
  { family: "analogy", spec: { level: 1, stem: ["day", "night", "black"], key: "white", distractors: ["dark", "grey", "colour", "paint"], explanation: "Day and night are opposites, as are black and white.", feature: "antonym" } },
  { family: "classification", spec: { level: 1, stem: null, key: "chair", distractors: ["cat", "horse", "rabbit", "cow"], explanation: "All the others are animals.", feature: "category" } },
];

const PROMPTS: Record<"vocabulary" | "analogy" | "classification", string> = {
  vocabulary: "Which word is closest in meaning to the word shown?",
  analogy: "Which word completes the analogy?",
  classification: "Which word does not belong with the others?",
};

const CODES = { vocabulary: "VO", analogy: "AN", classification: "CL" } as const;

export function buildVerbalItem(
  family: "vocabulary" | "analogy" | "classification",
  spec: VerbalSpec,
  id: string,
  rng: { shuffle<T>(xs: readonly T[]): T[] },
  practice = false,
): Item {
  const options = rng.shuffle([spec.key, ...spec.distractors]).map((text, i) => ({
    id: "abcdefgh"[i],
    content: { type: "text" as const, text },
  }));
  const correctOptionId = options.find((o) => o.content.text === spec.key)!.id;
  const narrow = family === "vocabulary" ? "VL" : "LD";
  const difficulty = makeDifficulty("gc-expert-rating@1", LEVEL_LOGIT[spec.level], { band: spec.feature });
  return {
    id,
    version: 1,
    domain: "Gc",
    narrowAbility: narrow,
    family,
    practice,
    prompt: PROMPTS[family],
    stimulus:
      family === "analogy"
        ? { type: "analogy", a: (spec.stem as string[])[0], b: (spec.stem as string[])[1], c: (spec.stem as string[])[2] }
        : family === "vocabulary"
          ? { type: "text", lines: [], question: (spec.stem as string).toUpperCase() }
          : { type: "text", lines: [], question: PROMPTS.classification },
    response: { kind: "choice", options, correctOptionId },
    explanation: spec.explanation,
    rules: [`${family}:${spec.feature}`],
    difficulty,
    estimatedTimeSec: family === "vocabulary" ? 12 + 3 * spec.level : 18 + 4 * spec.level,
    timeLimitSec: family === "vocabulary" ? 45 : 75,
    provenance: { generator: "verbal-content", generatorVersion: "1.0.0", author: "project authors (hand-written)" },
  };
}

export { CODES as VERBAL_CODES };
