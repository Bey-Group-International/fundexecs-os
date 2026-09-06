// lib/meetings/background-store.ts
// Where an uploaded camera background is kept: this browser, and nowhere else.
//
// A background someone uploads is a photograph of wherever they are working —
// a home office, a hotel room, a kitchen. Putting that on a server means
// hosting it, backing it up, and deciding who else in their firm can see it.
// None of that buys the person anything: they want a picture behind their head
// on this laptop. So it stays in IndexedDB on the device that chose it.
//
// The cost of that choice, stated plainly because the UI has to say it: an
// uploaded background does not follow you to another computer or another
// browser, and clearing site data removes it.

const DB_NAME = "fundexecs-meeting-backgrounds";
const DB_VERSION = 1;
const STORE = "images";

export interface StoredBackground {
  id: string;
  name: string;
  blob: Blob;
  addedAt: number;
}

/** Everything here resolves rather than throws: no background is worth an error dialog. */
function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") { resolve(null); return; }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      // Private browsing modes and locked-down enterprise profiles.
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then((db) => {
    if (!db) return null;
    return new Promise<T | null>((resolve) => {
      let request: IDBRequest<T>;
      try {
        request = work(db.transaction(STORE, mode).objectStore(STORE));
      } catch {
        db.close();
        resolve(null);
        return;
      }
      request.onsuccess = () => { resolve(request.result); db.close(); };
      request.onerror = () => { resolve(null); db.close(); };
    });
  });
}

export async function listBackgrounds(): Promise<StoredBackground[]> {
  const rows = await run<StoredBackground[]>("readonly", (store) => store.getAll() as IDBRequest<StoredBackground[]>);
  // Newest first: the one someone just added is the one they are looking for.
  return (rows ?? []).sort((a, b) => b.addedAt - a.addedAt);
}

export async function getBackground(id: string): Promise<StoredBackground | null> {
  return (await run<StoredBackground>("readonly", (store) => store.get(id) as IDBRequest<StoredBackground>)) ?? null;
}

export async function addBackground(file: File): Promise<StoredBackground | null> {
  const record: StoredBackground = {
    id: crypto.randomUUID(),
    name: file.name || "Background",
    blob: file,
    addedAt: Date.now(),
  };
  const written = await run("readwrite", (store) => store.add(record));
  return written === null ? null : record;
}

export async function deleteBackground(id: string): Promise<void> {
  await run("readwrite", (store) => store.delete(id));
}
