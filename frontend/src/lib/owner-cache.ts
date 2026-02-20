import { API_BASE } from "./constants";

const LS_PREFIX = "owner_";
const memCache = new Map<number, string | null>();
const pending = new Map<number, Promise<string | null>>();

/** Synchronous lookup from memory/localStorage. Returns undefined on cache miss. */
export function resolveOwnerSync(ownerId: number): string | null | undefined {
  if (ownerId === 0) return null;
  if (memCache.has(ownerId)) return memCache.get(ownerId)!;
  const cached = localStorage.getItem(LS_PREFIX + ownerId);
  if (cached !== null) {
    const value = cached || null;
    memCache.set(ownerId, value);
    return value;
  }
  return undefined; // cache miss
}

/** Async lookup — checks cache, then fetches from API. */
export async function resolveOwner(ownerId: number): Promise<string | null> {
  const sync = resolveOwnerSync(ownerId);
  if (sync !== undefined) return sync;

  // Deduplicate in-flight requests
  if (pending.has(ownerId)) return pending.get(ownerId)!;

  const promise = fetchAndCache(ownerId);
  pending.set(ownerId, promise);
  try {
    return await promise;
  } finally {
    pending.delete(ownerId);
  }
}

async function fetchAndCache(ownerId: number): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/account/${ownerId}`);
    if (!res.ok) {
      localStorage.setItem(LS_PREFIX + ownerId, "");
      memCache.set(ownerId, null);
      return null;
    }
    const account = await res.text();
    localStorage.setItem(LS_PREFIX + ownerId, account);
    memCache.set(ownerId, account);
    return account;
  } catch {
    return null;
  }
}
