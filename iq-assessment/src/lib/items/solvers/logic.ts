/**
 * Brute-force logic checkers for deduction items. Each item's key is proven
 * by exhaustive model enumeration rather than trusted from the generator:
 *
 *  - linear orderings: all permutations consistent with the premises,
 *  - categorical syllogisms: all non-empty-region assignments of a three-set
 *    Venn diagram (with existential import: every named group is non-empty),
 *  - propositional arguments: full truth tables.
 */

// ---------------------------------------------------------------------------
// Linear orderings
// ---------------------------------------------------------------------------

/** "a is above b" (longer, heavier, ahead of …). */
export interface OrderPremise {
  above: string;
  below: string;
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

/** All total orders (index 0 = top) consistent with the premises. */
export function consistentOrders(labels: string[], premises: OrderPremise[]): string[][] {
  return permutations(labels).filter((order) =>
    premises.every((p) => order.indexOf(p.above) < order.indexOf(p.below)),
  );
}

export function mustBeAbove(orders: string[][], a: string, b: string): boolean {
  return orders.length > 0 && orders.every((o) => o.indexOf(a) < o.indexOf(b));
}

/** The label at `position` (0 = top) if it is the same in every order, else null. */
export function determinedAt(orders: string[][], position: number): string | null {
  if (orders.length === 0) return null;
  const first = orders[0][position];
  return orders.every((o) => o[position] === first) ? first : null;
}

// ---------------------------------------------------------------------------
// Categorical syllogisms
// ---------------------------------------------------------------------------

export type Quantifier = "all" | "no" | "some" | "some-not";

export interface Categorical {
  q: Quantifier;
  subject: 0 | 1 | 2;
  predicate: 0 | 1 | 2;
}

/** A model: which of the 7 regions (bitmask 1..7 over three sets) are non-empty. */
function holds(model: number[], s: Categorical): boolean {
  const inS = (r: number) => ((r >> s.subject) & 1) === 1;
  const inP = (r: number) => ((r >> s.predicate) & 1) === 1;
  switch (s.q) {
    case "all":
      return !model.some((r) => inS(r) && !inP(r));
    case "no":
      return !model.some((r) => inS(r) && inP(r));
    case "some":
      return model.some((r) => inS(r) && inP(r));
    case "some-not":
      return model.some((r) => inS(r) && !inP(r));
  }
}

function allModels(): number[][] {
  const models: number[][] = [];
  for (let mask = 0; mask < 128; mask++) {
    const regions = [1, 2, 3, 4, 5, 6, 7].filter((_, i) => (mask >> i) & 1);
    // existential import: every set has at least one member
    if ([0, 1, 2].every((set) => regions.some((r) => (r >> set) & 1))) models.push(regions);
  }
  return models;
}
const MODELS = allModels();

export function syllogismModels(premises: Categorical[]): number[][] {
  return MODELS.filter((m) => premises.every((p) => holds(m, p)));
}

export function entails(premises: Categorical[], conclusion: Categorical): boolean {
  const models = syllogismModels(premises);
  return models.length > 0 && models.every((m) => holds(m, conclusion));
}

// ---------------------------------------------------------------------------
// Propositional logic
// ---------------------------------------------------------------------------

export type Formula =
  | { op: "var"; name: string }
  | { op: "not"; a: Formula }
  | { op: "and" | "or" | "implies" | "iff"; a: Formula; b: Formula };

export const v = (name: string): Formula => ({ op: "var", name });
export const not = (a: Formula): Formula => ({ op: "not", a });
export const implies = (a: Formula, b: Formula): Formula => ({ op: "implies", a, b });
export const or = (a: Formula, b: Formula): Formula => ({ op: "or", a, b });
export const and = (a: Formula, b: Formula): Formula => ({ op: "and", a, b });

export function evaluate(f: Formula, env: Record<string, boolean>): boolean {
  switch (f.op) {
    case "var":
      return env[f.name];
    case "not":
      return !evaluate(f.a, env);
    case "and":
      return evaluate(f.a, env) && evaluate(f.b, env);
    case "or":
      return evaluate(f.a, env) || evaluate(f.b, env);
    case "implies":
      return !evaluate(f.a, env) || evaluate(f.b, env);
    case "iff":
      return evaluate(f.a, env) === evaluate(f.b, env);
  }
}

function variables(f: Formula, acc = new Set<string>()): Set<string> {
  if (f.op === "var") acc.add(f.name);
  else if (f.op === "not") variables(f.a, acc);
  else {
    variables(f.a, acc);
    variables(f.b, acc);
  }
  return acc;
}

export function propositionalModels(premises: Formula[]): Record<string, boolean>[] {
  const names = [...premises.reduce((acc, p) => variables(p, acc), new Set<string>())].sort();
  const out: Record<string, boolean>[] = [];
  for (let mask = 0; mask < 1 << names.length; mask++) {
    const env = Object.fromEntries(names.map((n, i) => [n, ((mask >> i) & 1) === 1]));
    if (premises.every((p) => evaluate(p, env))) out.push(env);
  }
  return out;
}

export function propEntails(premises: Formula[], conclusion: Formula): boolean {
  const models = propositionalModels(premises);
  return models.length > 0 && models.every((m) => evaluate(conclusion, m));
}
