import type { SemanticSnapshot } from "./semantic";
import type { InPublicMode, StoryState } from "./story";
import type { LogEvent } from "./types";
import { FREE_SESSION_LIMIT } from "./product";
import type { CompositionState } from "./composition";

const DB_NAME = "inpublic";
const SESSIONS_STORE = "sessions";
const RECORDINGS_STORE = "recordings";
const VERSION = 2;

export interface RecordingMetadata {
  sessionId: string;
  title: string;
  mode: InPublicMode;
  transcript: string;
  story?: StoryState;
  semantic?: SemanticSnapshot;
  page: number;
  timestamp: string;
  durationMs: number;
  mimeType: string;
  fileSize: number;
  includesCanvas: boolean;
  includesMicrophone: boolean;
  includesWebcam: boolean;
  transcriptVisible: boolean;
  interfaceVisible: boolean;
  log: LogEvent[];
  composition?: CompositionState;
}

export interface SavedRecording {
  id: string;
  metadata: RecordingMetadata;
  blob: Blob;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        db.createObjectStore(SESSIONS_STORE);
      }
      if (!db.objectStoreNames.contains(RECORDINGS_STORE)) {
        db.createObjectStore(RECORDINGS_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveRecording(recording: SavedRecording): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(RECORDINGS_STORE, "readwrite");
    const store = transaction.objectStore(RECORDINGS_STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      const existing = (request.result as SavedRecording[])
        .filter((item) => item.id !== recording.id)
        .sort((a, b) => Date.parse(a.metadata.timestamp) - Date.parse(b.metadata.timestamp));
      while (existing.length >= FREE_SESSION_LIMIT) {
        const oldest = existing.shift();
        if (oldest) store.delete(oldest.id);
      }
      store.put(recording);
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

export async function listRecordings(): Promise<SavedRecording[]> {
  const db = await open();
  const recordings = await new Promise<SavedRecording[]>((resolve, reject) => {
    const transaction = db.transaction(RECORDINGS_STORE, "readonly");
    const request = transaction.objectStore(RECORDINGS_STORE).getAll();
    request.onsuccess = () => resolve(request.result as SavedRecording[]);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return recordings.sort(
    (a, b) => Date.parse(b.metadata.timestamp) - Date.parse(a.metadata.timestamp),
  );
}

export async function deleteRecording(id: string): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(RECORDINGS_STORE, "readwrite");
    transaction.objectStore(RECORDINGS_STORE).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function downloadRecordingMetadata(metadata: RecordingMetadata) {
  downloadBlob(
    new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" }),
    `inpublic-${metadata.sessionId}.json`,
  );
}
