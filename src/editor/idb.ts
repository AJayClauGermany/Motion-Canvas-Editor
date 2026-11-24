/**
 * A little IndexedDB: what does not fit in localStorage. `kv` holds the
 * project folder's handle (handles can be stored, not serialised); `assets`
 * holds sound clips while no folder is connected.
 */
type Store = 'kv' | 'assets';

let db: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('mce', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('kv');
      request.result.createObjectStore('assets');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return db;
}

async function run<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await open();
  return new Promise((resolve, reject) => {
    const request = fn(database.transaction(store, mode).objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const idbGet = <T>(store: Store, key: string) => run<T | undefined>(store, 'readonly', s => s.get(key));
export const idbSet = (store: Store, key: string, value: unknown) => run(store, 'readwrite', s => s.put(value, key));
export const idbDelete = (store: Store, key: string) => run(store, 'readwrite', s => s.delete(key));
export const idbKeys = (store: Store) => run(store, 'readonly', s => s.getAllKeys()) as Promise<string[]>;
