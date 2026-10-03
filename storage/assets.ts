import { getDB, newId, type AssetRecord } from "./indexedDB";

/**
 * Immutable binary assets (original photos, layer images, mask rasters).
 * Persisted as ArrayBuffer + MIME type rather than Blob, because WebKit cannot
 * store Blobs in IndexedDB in ephemeral sessions (Safari Private Browsing).
 * Returned records always carry a `blob`; recently used ones are memoised so
 * the same Blob object is reused (decoder caches key on it).
 */
const memo = new Map<string, AssetRecord>();
const MEMO_MAX = 8;

function remember(rec: AssetRecord) {
  memo.delete(rec.id);
  memo.set(rec.id, rec);
  while (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value!);
}

export async function putAsset(blob: Blob, name: string, id: string = newId()): Promise<AssetRecord> {
  const bytes = await blob.arrayBuffer();
  const stored = { id, bytes, name: name.slice(0, 255), type: blob.type, size: blob.size, createdAt: Date.now() };
  await (await getDB()).put("assets", stored as AssetRecord);
  const rec: AssetRecord = { ...stored, bytes: undefined, blob };
  remember(rec);
  return rec;
}

export async function getAsset(id: string): Promise<AssetRecord | undefined> {
  const hit = memo.get(id);
  if (hit) return hit;
  const raw = await (await getDB()).get("assets", id);
  if (!raw) return undefined;
  const blob = raw.blob ?? new Blob([raw.bytes ?? new ArrayBuffer(0)], { type: raw.type });
  const rec: AssetRecord = { ...raw, bytes: undefined, blob };
  remember(rec);
  return rec;
}

export async function deleteAsset(id: string): Promise<void> {
  memo.delete(id);
  await (await getDB()).delete("assets", id);
}
