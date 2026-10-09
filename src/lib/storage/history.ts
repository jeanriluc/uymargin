import { resolveStoredViability } from "@/lib/finance/engine";
import type { AnalysisInputs, Viability } from "@/lib/finance/types";
import type { MarketStats } from "@/lib/mlu/types";

export interface ChannelSummary {
  netProfit: number;
  netMargin: number;
  roi: number;
  viability: Viability;
}

export interface HistoryEntry {
  id: string;
  savedAt: string;
  inputs: AnalysisInputs;
  market: (MarketStats & { total: number; source: "mlu" | "manual" }) | null;
  ml: ChannelSummary;
  direct: ChannelSummary;
}

const STORAGE_KEY = "uymargin:history:v1";
const MAX_ENTRIES = 200;
const EMPTY: HistoryEntry[] = [];

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedValue: HistoryEntry[] = EMPTY;

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<HistoryEntry>;
  return typeof v.id === "string" && typeof v.savedAt === "string" && !!v.inputs && !!v.ml && !!v.direct;
}

/** Entries saved before the four-level traffic light keep working: the level is recalculated on read. */
function withCurrentViability(entry: HistoryEntry): HistoryEntry {
  return {
    ...entry,
    ml: { ...entry.ml, viability: resolveStoredViability(entry.ml) },
    direct: { ...entry.direct, viability: resolveStoredViability(entry.direct) },
  };
}

function read(): HistoryEntry[] {
  if (typeof window === "undefined") return EMPTY;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return EMPTY;
  }
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cachedValue = Array.isArray(parsed) ? parsed.filter(isHistoryEntry).map(withCurrentViability) : EMPTY;
  } catch {
    cachedValue = EMPTY;
  }
  return cachedValue;
}

/** Returns false when the browser refused the write (storage full, private mode). */
function write(entries: HistoryEntry[]): boolean {
  let saved = true;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch (err) {
    console.warn("[history] no se pudo guardar en localStorage", err);
    saved = false;
  }
  listeners.forEach((l) => l());
  return saved;
}

/** useSyncExternalStore-compatible store backed by localStorage */
export const historyStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  },
  getSnapshot: read,
  getServerSnapshot: () => EMPTY,
  add(entry: HistoryEntry): boolean {
    return write([entry, ...read()]);
  },
  remove(id: string) {
    write(read().filter((e) => e.id !== id));
  },
  clear() {
    write([]);
  },
};

export function createEntryId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
