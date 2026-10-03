/// <reference lib="webworker" />
/**
 * Export job handler (runs inside workers/pipeline.worker.ts): renders the
 * full-resolution original off the main thread, reporting progress.
 */
import { runExport, type ExportJob } from "@/engine/export/exportJob";

export type ExportWorkerRequest = { id: number; job: ExportJob };
export type ExportWorkerResponse =
  | { id: number; type: "progress"; fraction: number; message: string }
  | {
      id: number;
      type: "done";
      blob: Blob;
      width: number;
      height: number;
      usedGpu: boolean;
      metadataWritten: boolean;
      iccEmbedded: boolean;
    }
  | { id: number; type: "error"; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

export async function handleExport(data: ExportWorkerRequest) {
  const { id, job } = data;
  try {
    const res = await runExport(job, (fraction, message) =>
      ctx.postMessage({ id, type: "progress", fraction, message } satisfies ExportWorkerResponse),
    );
    job.source.close();
    ctx.postMessage({ id, type: "done", ...res } satisfies ExportWorkerResponse);
  } catch (err) {
    job.source.close();
    ctx.postMessage({
      id,
      type: "error",
      message: (err as Error).message || "Export failed",
    } satisfies ExportWorkerResponse);
  }
}
