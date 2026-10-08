/**
 * Browser wiring: the repository and engine context used by the UI.
 */

import { ACTIVE_CALIBRATION } from "../norms/registry";
import { ParameterResolver } from "../psychometrics/parameters";
import type { ItemBank } from "../items/types";
import { ItemBankIndex, type EngineContext } from "./engine";
import { LocalSessionRepository, MemoryStorage, type KeyValueStorage, type SessionRepository } from "./repository";

let repo: SessionRepository | null = null;

function storage(): KeyValueStorage {
  try {
    const s = window.localStorage;
    const probe = "iqa:probe";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    // Private browsing modes may block storage: keep the session in memory
    // (it will not survive a reload, which the UI warns about).
    return new MemoryStorage();
  }
}

export function getRepository(): SessionRepository {
  repo ??= new LocalSessionRepository(storage());
  return repo;
}

export function storageIsPersistent(): boolean {
  return !(storage() instanceof MemoryStorage);
}

export function browserEngineContext(bank: ItemBank): EngineContext {
  return { bank: new ItemBankIndex(bank), resolver: new ParameterResolver(ACTIVE_CALIBRATION), now: () => Date.now() };
}
