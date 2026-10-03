/// <reference lib="webworker" />
/**
 * The single worker entry point for heavy processing. Export jobs and AI jobs
 * are dispatched by message shape. (One entry avoids bundler worker-chunk
 * mix-ups; ONNX Runtime is still only loaded on the first AI request.)
 */
import { handleExport, type ExportWorkerRequest } from "./export.worker";
import { handleAi, type AiRequest } from "./ai.worker";
import { handleHeic, type HeicRequest } from "./heic.handler";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<ExportWorkerRequest | AiRequest | HeicRequest>) => {
  const data = e.data;
  if ("job" in data) void handleExport(data);
  else if ("kind" in data && data.kind === "heic") void handleHeic(data);
  else void handleAi(data as AiRequest);
};
