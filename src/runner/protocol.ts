/** Must match the `pyodide` dev dependency, which the Node integration test runs against. */
export const PYODIDE_VERSION = "314.0.7";
export const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

export type OutputStream = "stdout" | "stderr";

export interface OutputChunk {
  stream: OutputStream;
  text: string;
}

export type WorkerRequest = { type: "run"; runId: number; code: string };

export type WorkerResponse =
  | { type: "ready" }
  | { type: "status"; runId: number; message: string }
  | { type: "output"; runId: number; chunks: OutputChunk[] }
  | { type: "done"; runId: number; exitCode: number; durationMs: number }
  | { type: "crashed"; runId: number; message: string }
  | { type: "fatal"; message: string };
