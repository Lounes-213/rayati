/**
 * Storage layer: a tiny key/value interface so services can be dependency-injected
 * in tests. Every call is wrapped: private mode, full quota or a disabled
 * localStorage must never break the show.
 */
export interface KVStorage {
  get(key: string): string | null;
  set(key: string, value: string): boolean;
  remove(key: string): void;
  readonly persistent: boolean;
}

export function createStorage(namespace = 'rayati'): KVStorage {
  const memory = new Map<string, string>();
  let backing: Storage | null = null;

  try {
    const probe = '__rayati_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    backing = window.localStorage;
  } catch {
    backing = null; // private mode / disabled storage -> memory only
  }

  const full = (key: string) => `${namespace}.${key}`;

  return {
    persistent: backing !== null,
    get(key) {
      try {
        return backing ? backing.getItem(full(key)) : (memory.get(key) ?? null);
      } catch {
        return memory.get(key) ?? null;
      }
    },
    set(key, value) {
      memory.set(key, value);
      if (!backing) return false;
      try {
        backing.setItem(full(key), value);
        return true;
      } catch {
        return false; // quota exceeded: memory copy still works for this session
      }
    },
    remove(key) {
      memory.delete(key);
      try {
        backing?.removeItem(full(key));
      } catch {
        /* ignore */
      }
    },
  };
}

export function getJson<T>(storage: KVStorage, key: string, fallback: T): T {
  const raw = storage.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    storage.remove(key);
    return fallback;
  }
}

export function setJson(storage: KVStorage, key: string, value: unknown): boolean {
  try {
    return storage.set(key, JSON.stringify(value));
  } catch {
    return false;
  }
}

/** In-memory storage for unit tests and for the "storage unavailable" path. */
export function createMemoryStorage(): KVStorage {
  const memory = new Map<string, string>();
  return {
    persistent: false,
    get: (key) => memory.get(key) ?? null,
    set: (key, value) => (memory.set(key, value), true),
    remove: (key) => void memory.delete(key),
  };
}
