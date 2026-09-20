/** Must match the `pyodide` dev dependency, which the Node integration test runs against. */
export const PYODIDE_VERSION = "314.0.7";
export const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

export type OutputStream = "stdout" | "stderr";

export interface OutputChunk {
  stream: OutputStream;
  text: string;
}

/** One test case as the worker sees it: its stdin. */
export interface TestInput {
  id: string;
  input: string;
}

/** What one test case produced. */
export interface CaseResult {
  id: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  /** Output hit the capture limit and the rest was dropped. */
  truncated: boolean;
}

export type WorkerRequest =
  | {
      type: "run";
      runId: number;
      code: string;
      /** Where the page writes stdin lines; null when the page cannot share memory. */
      input: SharedArrayBuffer | null;
    }
  /** Run the program once per case, each with its input as stdin and its output captured. */
  | { type: "test"; runId: number; code: string; cases: TestInput[] };

export type WorkerResponse =
  | { type: "ready" }
  | { type: "status"; runId: number; message: string }
  | { type: "output"; runId: number; chunks: OutputChunk[] }
  /** The program is blocked reading stdin. */
  | { type: "input"; runId: number }
  /** One test case finished; `done` follows the last one. */
  | ({ type: "case"; runId: number } & CaseResult)
  | { type: "done"; runId: number; exitCode: number; durationMs: number }
  | { type: "crashed"; runId: number; message: string }
  | { type: "fatal"; message: string };
