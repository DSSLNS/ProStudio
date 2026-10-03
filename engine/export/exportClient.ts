/**
 * Main-thread export entry point. Decodes the ORIGINAL file at full resolution
 * (never the preview), then renders/encodes in a worker when possible.
 */
import type { ExportJob, ExportResult } from "./exportJob";
import type { ExportWorkerResponse } from "@/workers/export.worker";
import { decodeToBitmap, type SniffedFormat } from "@/lib/fileUtils";
import { getBrowserCapabilities } from "@/lib/browserCapabilities";
import { collectAssetIds } from "@/types/layers";
import { getAsset } from "@/storage/assets";

export type ExportRequest = Omit<ExportJob, "source" | "originalBytes" | "preferGpu" | "assetBlobs"> & {
  original: Blob;
  originalFormat: SniffedFormat;
  gpuAcceleration: boolean;
};

let nextId = 1;

export async function exportImage(
  req: ExportRequest,
  onProgress?: (f: number, msg: string) => void,
): Promise<ExportResult> {
  onProgress?.(0, "Decoding original at full resolution");
  const caps = await getBrowserCapabilities();
  const source = await decodeToBitmap(req.original, req.originalFormat); // full resolution — no maxLongEdge
  const originalBytes = req.preserveMetadata && req.originalFormat === "jpeg" ? await req.original.arrayBuffer() : null;
  const { original: _o, originalFormat: _f, gpuAcceleration, ...rest } = req;
  void _o;
  void _f;
  const assetBlobs: Record<string, Blob> = {};
  for (const id of collectAssetIds(req.layers)) {
    const a = await getAsset(id);
    if (a) assetBlobs[id] = a.blob;
  }
  const job: ExportJob = { ...rest, source, originalBytes, preferGpu: gpuAcceleration, assetBlobs };

  const useWorker = caps.workers && caps.offscreenCanvas && (caps.offscreenWebgl2 || !gpuAcceleration);
  if (!useWorker) {
    const { runExport } = await import("./exportJob");
    try {
      return await runExport(job, onProgress);
    } finally {
      source.close();
    }
  }

  const worker = new Worker(new URL("../../workers/pipeline.worker.ts", import.meta.url), { type: "module" });
  const id = nextId++;
  try {
    return await new Promise<ExportResult>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<ExportWorkerResponse>) => {
        const msg = e.data;
        if (msg.id !== id) return;
        if (msg.type === "progress") onProgress?.(msg.fraction, msg.message);
        else if (msg.type === "done") resolve(msg);
        else reject(new Error(msg.message));
      };
      worker.onerror = (e) =>
        reject(new Error(e.message || "Export worker crashed (the device may be out of memory)."));
      const transfer: Transferable[] = [source];
      if (originalBytes) transfer.push(originalBytes);
      worker.postMessage({ id, job }, transfer);
    });
  } finally {
    worker.terminate();
  }
}
