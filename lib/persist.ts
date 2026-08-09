/**
 * Debounced local persistence.
 *
 * A take is thirty minutes of someone's thinking and it lived entirely in a
 * React ref. An accidental refresh lost all of it. This writes the elements,
 * the semantic board and the log to IndexedDB on a timer, and restores on
 * mount.
 *
 * IndexedDB rather than localStorage: a board with a few hundred elements
 * comfortably exceeds the 5MB string quota, and localStorage writes are
 * synchronous on the main thread — which is the one thread the live line needs.
 */

import type { SemanticSnapshot } from "./semantic";
import type { SceneElement } from "./scene";
import type { LogEvent } from "./types";
import type { InPublicMode, StoryState } from "./story";
import type { CompositionState } from "./composition";

const DB_NAME = "inpublic";
const STORE = "sessions";
const RECORDINGS_STORE = "recordings";
const KEY = "current";
const VERSION = 2;

export interface PersistedSession {
  id?: string;
  savedAt: number;
  startedAt: number | null;
  page: number;
  elements: SceneElement[];
  semantic: SemanticSnapshot;
  log: LogEvent[];
  mode?: InPublicMode;
  story?: StoryState;
  composition?: CompositionState;
  /** Set by the dashboard when a session is renamed. Absent means "derive it". */
  title?: string;
  /** Set by the dashboard. The canvas neither reads nor writes this. */
  starred?: boolean;
}

/**
 * The canvas restores from a single "current" record, and always has. The
 * dashboard needs a library instead, so each autosave also lands under its own
 * id behind this prefix. Two writes in one transaction, and the canvas path
 * is untouched — `loadSession` still reads `KEY` and knows nothing about this.
 */
const LIBRARY_PREFIX = "session:";
const libraryKey = (id: string) => `${LIBRARY_PREFIX}${id}`;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(RECORDINGS_STORE)) {
        db.createObjectStore(RECORDINGS_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSession(session: PersistedSession): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.put(session, KEY);
    // A session without an id predates the library; it still restores from
    // "current", it just does not appear in the dashboard list.
    if (session.id) store.put(session, libraryKey(session.id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/**
 * Every session in the library, newest first.
 *
 * Only records written under the library prefix are returned, so the "current"
 * pointer never shows up as a second copy of the session it points at.
 */
export async function listSessions(): Promise<PersistedSession[]> {
  try {
    const db = await open();
    const sessions = await new Promise<PersistedSession[]>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).openCursor();
      const found: PersistedSession[] = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return resolve(found);
        if (typeof cursor.key === "string" && cursor.key.startsWith(LIBRARY_PREFIX)) {
          found.push(cursor.value as PersistedSession);
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
    db.close();
    return sessions.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

/** One library session by id, for reopening it on the canvas. */
export async function loadSessionById(id: string): Promise<PersistedSession | null> {
  try {
    const db = await open();
    const result = await new Promise<PersistedSession | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(libraryKey(id));
      request.onsuccess = () => resolve(request.result as PersistedSession | undefined);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return result ?? null;
  } catch {
    return null;
  }
}

async function writeLibrary(id: string, session: PersistedSession | null): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      if (session) store.put(session, libraryKey(id));
      else store.delete(libraryKey(id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    /* private mode or quota — the list simply does not change */
  }
}

export async function renameSession(id: string, title: string): Promise<void> {
  const session = await loadSessionById(id);
  if (!session) return;
  await writeLibrary(id, { ...session, title });
}

export async function setSessionStarred(id: string, starred: boolean): Promise<void> {
  const session = await loadSessionById(id);
  if (!session) return;
  await writeLibrary(id, { ...session, starred });
}

/** Copies a session into a new id. The canvas's "current" record is untouched. */
export async function duplicateSession(id: string, deriveTitle: (from: PersistedSession) => string): Promise<string | null> {
  const session = await loadSessionById(id);
  if (!session) return null;
  const copyId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `session-${Date.now()}`;
  await writeLibrary(copyId, { ...session, id: copyId, savedAt: Date.now(), title: deriveTitle(session) });
  return copyId;
}

export async function deleteSession(id: string): Promise<void> {
  await writeLibrary(id, null);
}

/** Restore a recently deleted library row without changing the active canvas. */
export async function restoreDeletedSession(session: PersistedSession): Promise<void> {
  if (!session.id) return;
  await writeLibrary(session.id, session);
}

export async function loadSession(): Promise<PersistedSession | null> {
  try {
    const db = await open();
    const result = await new Promise<PersistedSession | undefined>(
      (resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(KEY);
        req.onsuccess = () => resolve(req.result as PersistedSession | undefined);
        req.onerror = () => reject(req.error);
      },
    );
    db.close();
    return result ?? null;
  } catch {
    // Private browsing, quota, or a corrupt store. Never block startup on this.
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    /* nothing to clear */
  }
}

/**
 * Trailing-edge debounce. Writes are cheap but not free, and the live line
 * commits ~5x/second — saving on every commit would put IndexedDB in the hot
 * path.
 */
export function makeAutosave(
  getSession: () => PersistedSession,
  intervalMs = 3000,
  onStateChange?: (state: "saving" | "saved" | "error") => void,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;

  const flush = async () => {
    if (inFlight) return;
    inFlight = true;
    onStateChange?.("saving");
    try {
      await saveSession(getSession());
      onStateChange?.("saved");
    } catch {
      /* a failed autosave must never surface on the canvas */
      onStateChange?.("error");
    } finally {
      inFlight = false;
    }
  };

  return {
    schedule() {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void flush();
      }, intervalMs);
    },
    async flushNow() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await flush();
    },
  };
}
