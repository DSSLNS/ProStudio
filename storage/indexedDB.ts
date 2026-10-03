import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { EditRecipe } from "@/types/edit";
import type { ImageMetadataSummary } from "@/lib/imageMetadata";
import type { LayerDoc } from "@/types/layers";

export interface AssetRecord {
  id: string;
  /** Always present on records returned by storage/assets.ts (rebuilt from `bytes`). */
  blob: Blob;
  /** Raw bytes as persisted. Blobs are not stored directly: WebKit cannot store Blobs in
   *  IndexedDB in ephemeral sessions (Safari Private Browsing, automation). */
  bytes?: ArrayBuffer;
  name: string;
  type: string;
  size: number;
  createdAt: number;
}

export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: number;
  modifiedAt: number;
  origin: "import" | "camera";
  sourceAssetId: string;
  sourceName: string;
  sourceType: string;
  sourceSize: number;
  /** Oriented original dimensions (after EXIF orientation). */
  width: number;
  height: number;
  recipe: EditRecipe;
  layers: LayerDoc[];
  metadata: ImageMetadataSummary | null;
}

export interface HistoryEntry {
  label: string;
  recipe: EditRecipe;
  layers: LayerDoc[];
  at: number;
}

export interface HistoryRecord {
  projectId: string;
  entries: HistoryEntry[];
  index: number;
}

export interface ThumbnailRecord {
  projectId: string;
  /** Legacy records stored a Blob; new ones store bytes + type (WebKit-safe). */
  blob?: Blob;
  bytes?: ArrayBuffer;
  type?: string;
}

export interface LutRecord {
  id: string;
  name: string;
  size: number;
  /** RGB triplets, size^3 entries, red fastest (as in .cube). */
  data: Float32Array;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  createdAt: number;
}

export interface PresetRecord {
  id: string;
  name: string;
  recipe: Partial<EditRecipe>;
  createdAt: number;
}

interface ProStudioDB extends DBSchema {
  assets: { key: string; value: AssetRecord };
  projects: { key: string; value: ProjectRecord; indexes: { modifiedAt: number } };
  history: { key: string; value: HistoryRecord };
  thumbnails: { key: string; value: ThumbnailRecord };
  luts: { key: string; value: LutRecord };
  presets: { key: string; value: PresetRecord };
}

const DB_NAME = "prostudio";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<ProStudioDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<ProStudioDB>> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new Error("IndexedDB is not available in this browser, so projects cannot be saved locally."),
    );
  }
  if (!dbPromise) {
    dbPromise = openDB<ProStudioDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore("assets", { keyPath: "id" });
        const projects = db.createObjectStore("projects", { keyPath: "id" });
        projects.createIndex("modifiedAt", "modifiedAt");
        db.createObjectStore("history", { keyPath: "projectId" });
        db.createObjectStore("thumbnails", { keyPath: "projectId" });
        db.createObjectStore("luts", { keyPath: "id" });
        db.createObjectStore("presets", { keyPath: "id" });
      },
      blocked() {
        console.warn("[ProStudio] Database upgrade blocked by another open tab.");
      },
    });
  }
  return dbPromise;
}

export function newId(): string {
  return crypto.randomUUID();
}

/** Ask the browser to keep our storage from being evicted under pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e) return null;
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return null;
  }
}
