/**
 * Freeze the item bank to src/data/item-bank.json.
 *
 *   npm run bank:generate   # (re)write the frozen bank
 *   npm run bank:check      # fail if the generators no longer reproduce it
 *
 * Why freeze? Calibration data and norms are tied to exact item content. If a
 * generator changes, items must change *visibly* (a new frozen file, and a
 * version bump for every item whose content hash changed) — never silently.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { stableStringify } from "../src/lib/items/generators/common";
import { generateItemBank } from "../src/lib/items/generators/index";
import type { Item, ItemBank } from "../src/lib/items/types";

const OUT = resolve(__dirname, "../src/data/item-bank.json");

export function contentHash(item: Item): string {
  const { contentHash: _ignored, ...rest } = item;
  void _ignored;
  return createHash("sha256").update(stableStringify(rest)).digest("hex");
}

function build(): ItemBank {
  const bank = generateItemBank();
  const ids = new Set<string>();
  for (const item of bank.items) {
    if (ids.has(item.id)) throw new Error(`Duplicate item id ${item.id}`);
    ids.add(item.id);
    item.contentHash = contentHash(item);
  }
  return bank;
}

const check = process.argv.includes("--check");
const t0 = Date.now();
const bank = build();
const json = JSON.stringify(bank) + "\n";

if (check) {
  const frozen = readFileSync(OUT, "utf8");
  if (frozen !== json) {
    const old = JSON.parse(frozen) as ItemBank;
    const oldById = new Map(old.items.map((i) => [i.id, i]));
    const changed = bank.items.filter((i) => oldById.get(i.id)?.contentHash !== i.contentHash).map((i) => i.id);
    console.error(
      `Item bank drift: the generators no longer reproduce src/data/item-bank.json.\n` +
        `Changed or new items (${changed.length}): ${changed.slice(0, 20).join(", ")}${changed.length > 20 ? " …" : ""}\n` +
        `If the change is intended, bump the affected item versions and run "npm run bank:generate".`,
    );
    process.exit(1);
  }
  console.log(`Item bank OK: ${bank.items.length} items reproduce exactly (${Date.now() - t0} ms).`);
} else {
  writeFileSync(OUT, json);
  const scored = bank.items.filter((i) => !i.practice);
  const byDomain = scored.reduce<Record<string, number>>((m, i) => ({ ...m, [i.domain]: (m[i.domain] ?? 0) + 1 }), {});
  console.log(`Wrote ${bank.items.length} items (${scored.length} scored, ${bank.items.length - scored.length} practice) to ${OUT}`);
  console.log(byDomain, `${(json.length / 1024).toFixed(0)} KiB, ${Date.now() - t0} ms`);
}
