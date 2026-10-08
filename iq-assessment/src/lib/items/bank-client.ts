/**
 * Lazy loader for the frozen item bank (≈0.6 MB of JSON). Loaded on demand so
 * pages that do not administer or review items do not pay for it.
 */

import type { ItemBank } from "./types";

let cache: Promise<ItemBank> | null = null;

export function loadItemBank(): Promise<ItemBank> {
  cache ??= import("@/data/item-bank.json").then((m) => m.default as unknown as ItemBank);
  return cache;
}
