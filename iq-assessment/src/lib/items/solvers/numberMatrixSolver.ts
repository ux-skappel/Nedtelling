/**
 * Number-matrix verifier. Tries every whole number 0..999 in the empty cell
 * and checks a library of row-wise and column-wise relations. The item is
 * valid only if exactly one value makes at least one relation hold for all
 * three rows (or all three columns).
 */

type Rel = { name: string; holds: (rows: number[][]) => boolean };

const perRow = (name: string, f: (a: number, b: number) => number): Rel => ({
  name,
  holds: (rows) => rows.every(([a, b, c]) => f(a, b) === c),
});

const RELATIONS: Rel[] = [
  perRow("a+b", (a, b) => a + b),
  perRow("a-b", (a, b) => a - b),
  perRow("b-a", (a, b) => b - a),
  perRow("a*b", (a, b) => a * b),
  perRow("a+2b", (a, b) => a + 2 * b),
  perRow("2a+b", (a, b) => 2 * a + b),
  perRow("2(a+b)", (a, b) => 2 * (a + b)),
  perRow("a*b-a", (a, b) => a * b - a),
  perRow("a*b-b", (a, b) => a * b - b),
  perRow("a*b+a", (a, b) => a * b + a),
  perRow("a*b+b", (a, b) => a * b + b),
  perRow("a^2+b", (a, b) => a * a + b),
  perRow("a+b^2", (a, b) => a + b * b),
  perRow("a-2b", (a, b) => a - 2 * b),
  perRow("2a-b", (a, b) => 2 * a - b),
  perRow("2(a-b)", (a, b) => 2 * (a - b)),
  perRow("|a-b|", (a, b) => Math.abs(a - b)),
  perRow("(a+b)/2", (a, b) => (a + b) / 2),
  perRow("a*b/2", (a, b) => (a * b) / 2),
  perRow("a/b", (a, b) => a / b),
  { name: "equal-row-sums", holds: (rows) => rows.every((r) => r[0] + r[1] + r[2] === rows[0][0] + rows[0][1] + rows[0][2]) },
  { name: "equal-row-products", holds: (rows) => rows.every((r) => r[0] * r[1] * r[2] === rows[0][0] * rows[0][1] * rows[0][2]) },
  { name: "row-progression", holds: (rows) => rows.every(([a, b, c]) => b - a === c - b && b !== a) },
  {
    name: "same-row-step",
    holds: (rows) => rows.every(([a, b, c]) => b - a === rows[0][1] - rows[0][0] && c - b === rows[0][2] - rows[0][1]),
  },
];

export type NumberMatrixVerdict =
  | { status: "unique"; value: number; rules: string[] }
  | { status: "no-rule" }
  | { status: "ambiguous"; values: number[] };

export function solveNumberMatrix(cells: (number | null)[]): NumberMatrixVerdict {
  const missing = cells.indexOf(null);
  if (missing < 0 || cells.length !== 9) throw new Error("Expected 9 cells with one empty");
  const found = new Map<number, string[]>();
  for (let x = 0; x <= 999; x++) {
    const filled = cells.map((c) => (c === null ? x : c));
    const rows = [0, 1, 2].map((r) => filled.slice(r * 3, r * 3 + 3));
    const cols = [0, 1, 2].map((c) => [filled[c], filled[c + 3], filled[c + 6]]);
    for (const rel of RELATIONS) {
      if (rel.holds(rows)) found.set(x, [...(found.get(x) ?? []), `row:${rel.name}`]);
      if (rel.holds(cols)) found.set(x, [...(found.get(x) ?? []), `col:${rel.name}`]);
    }
  }
  if (found.size === 0) return { status: "no-rule" };
  if (found.size > 1) return { status: "ambiguous", values: [...found.keys()] };
  const [value, rules] = [...found.entries()][0];
  return { status: "unique", value, rules };
}
