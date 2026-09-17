import type { WorkerResponse } from "./protocol";
import type { WorkerFactory } from "./runnerController";

export const createPyodideWorker: WorkerFactory = (onMessage, onError) => {
  const worker = new Worker(new URL("./pyodide.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => onMessage(event.data);
  worker.onerror = (event) => {
    event.preventDefault();
    onError(event.message || "the worker script failed to load");
  };
  return {
    post: (message) => worker.postMessage(message),
    terminate: () => worker.terminate(),
  };
};
