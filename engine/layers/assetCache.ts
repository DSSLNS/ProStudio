/**
 * Decoded bitmaps for layer/mask assets, loaded on demand and shared by every
 * render. Each asset is decoded once (no per-render copies).
 */
import type { AssetSource } from "./raster";

export class AssetCache implements AssetSource {
  private bitmaps = new Map<string, ImageBitmap>();
  private pending = new Map<string, Promise<void>>();
  private failed = new Set<string>();

  constructor(private readonly loader: (id: string) => Promise<Blob | undefined>) {}

  get(id: string): ImageBitmap | undefined {
    return this.bitmaps.get(id);
  }

  has(ids: Iterable<string>): boolean {
    for (const id of ids) if (!this.bitmaps.has(id) && !this.failed.has(id)) return false;
    return true;
  }

  /** Decode any missing assets. Resolves when all are available (or failed). */
  async ensure(ids: Iterable<string>): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const id of ids) {
      if (this.bitmaps.has(id) || this.failed.has(id)) continue;
      let p = this.pending.get(id);
      if (!p) {
        p = (async () => {
          try {
            const blob = await this.loader(id);
            if (!blob) throw new Error("missing");
            this.bitmaps.set(id, await createImageBitmap(blob, { imageOrientation: "from-image" }));
          } catch {
            this.failed.add(id);
          } finally {
            this.pending.delete(id);
          }
        })();
        this.pending.set(id, p);
      }
      jobs.push(p);
    }
    await Promise.all(jobs);
  }

  /** Register an already-decoded bitmap (e.g. a freshly created selection raster). */
  put(id: string, bmp: ImageBitmap) {
    this.bitmaps.get(id)?.close();
    this.bitmaps.set(id, bmp);
    this.failed.delete(id);
  }

  /** Forget one asset (e.g. a temporary live-preview bitmap). */
  drop(id: string) {
    this.bitmaps.get(id)?.close();
    this.bitmaps.delete(id);
  }

  dispose() {
    for (const b of this.bitmaps.values()) b.close();
    this.bitmaps.clear();
  }
}
