/**
 * Session persistence.
 *
 * The interface is asynchronous even though the only implementation today
 * (browser local storage) is synchronous, so a database-backed repository
 * (e.g. Supabase, see docs/ARCHITECTURE.md) can be dropped in without
 * touching the UI.
 */

import { SESSION_SCHEMA_VERSION, type Session } from "./session";

export interface SessionSummary {
  id: string;
  mode: Session["mode"];
  createdAt: number;
  completedAt: number | null;
  endedEarly: boolean;
}

export interface SessionRepository {
  load(id: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  remove(id: string): Promise<void>;
  list(): Promise<SessionSummary[]>;
  getActiveId(): Promise<string | null>;
  setActiveId(id: string | null): Promise<void>;
  clearAll(): Promise<void>;
}

export function summarize(s: Session): SessionSummary {
  return { id: s.id, mode: s.mode, createdAt: s.createdAt, completedAt: s.completedAt, endedEarly: s.endedEarly };
}

/**
 * Upgrade a stored session to the current schema, or return null if it
 * cannot be read. There is only one schema version so far; this is the hook
 * for future migrations.
 */
export function migrateSession(raw: unknown): Session | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<Session>;
  if (s.schemaVersion !== SESSION_SCHEMA_VERSION) return null;
  if (typeof s.id !== "string" || !Array.isArray(s.sections) || typeof s.sectionIndex !== "number") return null;
  return s as Session;
}

/** Minimal subset of the Web Storage API, so tests can supply a fake. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const MAX_STORED_SESSIONS = 25;

export class LocalSessionRepository implements SessionRepository {
  constructor(
    private readonly storage: KeyValueStorage,
    private readonly prefix = "iqa:v1:",
  ) {}

  private key(id: string) {
    return `${this.prefix}session:${id}`;
  }

  private readIndex(): SessionSummary[] {
    try {
      const raw = this.storage.getItem(`${this.prefix}index`);
      const parsed = raw ? (JSON.parse(raw) as SessionSummary[]) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeIndex(index: SessionSummary[]) {
    this.storage.setItem(`${this.prefix}index`, JSON.stringify(index));
  }

  async load(id: string): Promise<Session | null> {
    try {
      const raw = this.storage.getItem(this.key(id));
      return raw ? migrateSession(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  async save(session: Session): Promise<void> {
    this.storage.setItem(this.key(session.id), JSON.stringify(session));
    const index = this.readIndex().filter((s) => s.id !== session.id);
    index.unshift(summarize(session));
    // Keep storage bounded: drop the oldest finished sessions beyond the cap.
    while (index.length > MAX_STORED_SESSIONS) {
      const victim = [...index].reverse().find((s) => s.completedAt !== null) ?? index[index.length - 1];
      index.splice(index.indexOf(victim), 1);
      this.storage.removeItem(this.key(victim.id));
    }
    this.writeIndex(index);
  }

  async remove(id: string): Promise<void> {
    this.storage.removeItem(this.key(id));
    this.writeIndex(this.readIndex().filter((s) => s.id !== id));
    if ((await this.getActiveId()) === id) await this.setActiveId(null);
  }

  async list(): Promise<SessionSummary[]> {
    return [...this.readIndex()].sort((a, b) => b.createdAt - a.createdAt);
  }

  async getActiveId(): Promise<string | null> {
    return this.storage.getItem(`${this.prefix}active`);
  }

  async setActiveId(id: string | null): Promise<void> {
    if (id === null) this.storage.removeItem(`${this.prefix}active`);
    else this.storage.setItem(`${this.prefix}active`, id);
  }

  async clearAll(): Promise<void> {
    for (const s of this.readIndex()) this.storage.removeItem(this.key(s.id));
    this.storage.removeItem(`${this.prefix}index`);
    this.storage.removeItem(`${this.prefix}active`);
  }
}

export class MemoryStorage implements KeyValueStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}
