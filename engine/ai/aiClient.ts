/**
 * Main-thread API for local AI. Lazily starts the AI worker on first use;
 * nothing is loaded at app start. Images are processed on this device only.
 */
import manifest from "@/ai/models.json";
import type { AiRequest, AiResponse, ModelId } from "@/workers/ai.worker";

export type { ModelId };
export const MODELS = manifest;

export const modelSize = (id: ModelId) => MODELS[id].files.reduce((a, f) => a + f.bytes, 0);

const installed = new Map<ModelId, Promise<boolean>>();

/** Is the model present on this server (public/models/<id>/)? Uses HEAD; cached per session. */
export function isModelInstalled(id: ModelId): Promise<boolean> {
  let p = installed.get(id);
  if (!p) {
    p = (async () => {
      try {
        for (const f of MODELS[id].files) {
          const res = await fetch(`/models/${id}/${f.name}`, { method: "HEAD" });
          if (!res.ok) return false;
        }
        return true;
      } catch {
        return false;
      }
    })();
    installed.set(id, p);
  }
  return p;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: Extract<AiResponse, { type: "done" }>) => void; reject: (e: Error) => void; progress?: (f: number, m: string) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("../../workers/pipeline.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<AiResponse>) => {
      const msg = e.data;
      const p = pending.get(msg.id);
      if (!p) return;
      if (msg.type === "progress") p.progress?.(msg.fraction, msg.message);
      else {
        pending.delete(msg.id);
        if (msg.type === "done") p.resolve(msg);
        else
          p.reject(
            new Error(
              msg.message === "MODEL_NOT_INSTALLED"
                ? "This AI model is not installed on this server. An administrator can install it with `npm run models`."
                : msg.message,
            ),
          );
      }
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || "The AI worker crashed (possibly out of memory)."));
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

type Payload = AiRequest extends infer R ? (R extends { id: number } ? Omit<R, "id"> : never) : never;

export function runAi(req: Payload, onProgress?: (f: number, m: string) => void): Promise<Extract<AiResponse, { type: "done" }>> {
  const id = nextId++;
  const w = getWorker();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, progress: onProgress });
    const transfer: Transferable[] = [];
    if ("rgba" in req) transfer.push(req.rgba.buffer);
    if ("mask" in req && req.mask) transfer.push(req.mask.buffer);
    w.postMessage({ ...req, id } as AiRequest, transfer);
  });
}

/** Stop any running AI job (terminates the worker; models reload on next use). */
export function cancelAi() {
  if (!worker) return;
  worker.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(new Error("Cancelled"));
  pending.clear();
}
