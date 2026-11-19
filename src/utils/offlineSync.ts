import type { OfflineQueueItem } from '../types';

const DB_NAME = 'vanisetu_offline_vault';
const STORE_NAME = 'sync_queue';
const DB_VERSION = 1;

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getOfflineQueue(): Promise<OfflineQueueItem[]> {
  try {
    const db = await openOfflineDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const items = (req.result || []) as OfflineQueueItem[];
        items.sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso));
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    const raw = localStorage.getItem('vanisetu_offline_fallback');
    return raw ? (JSON.parse(raw) as OfflineQueueItem[]) : [];
  }
}

export async function enqueueOfflineItem(item: OfflineQueueItem): Promise<void> {
  try {
    const db = await openOfflineDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    const existing = await getOfflineQueue();
    const updated = [item, ...existing.filter((x) => x.id !== item.id)];
    localStorage.setItem('vanisetu_offline_fallback', JSON.stringify(updated));
  }
}

export async function removeOfflineItem(id: string): Promise<void> {
  try {
    const db = await openOfflineDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    const existing = await getOfflineQueue();
    localStorage.setItem(
      'vanisetu_offline_fallback',
      JSON.stringify(existing.filter((x) => x.id !== id))
    );
  }
}
