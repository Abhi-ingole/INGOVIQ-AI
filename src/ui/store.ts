/* Tiny persistence layer: IndexedDB for file buffers & handles, localStorage for settings. All local to this browser. */
const DB = 'ingoviq-ai';
const STORE = 'kv';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise((res, rej) => {
      const t = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      t.onsuccess = () => res(t.result as T);
      t.onerror = () => rej(t.error);
    });
  } catch { return undefined; }
}
export async function idbSet(key: string, val: unknown): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((res, rej) => {
      const t = db.transaction(STORE, 'readwrite').objectStore(STORE).put(val, key);
      t.onsuccess = () => res();
      t.onerror = () => rej(t.error);
    });
  } catch { /* storage unavailable — app still works for this session */ }
}

export function lsGet<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? { ...fallback, ...JSON.parse(v) } : fallback; } catch { return fallback; }
}
export function lsGetArr<T>(key: string): T[] {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : []; } catch { return []; }
}
export function lsSet(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
}
