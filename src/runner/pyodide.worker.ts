import type { PyodideInterface } from "pyodide";
import { loadHarness, runProgram, type Harness } from "./harness";
import { readLine } from "./inputChannel";
import { OutputBuffer } from "./outputBuffer";
import { PYODIDE_INDEX_URL, type OutputStream, type WorkerRequest, type WorkerResponse } from "./protocol";

// Typed by hand: the DOM and WebWorker TypeScript libs conflict when both are loaded.
const ctx = self as unknown as {
  postMessage(message: WorkerResponse): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

let currentRunId = 0;
// Set for the duration of a run whose page can share memory; null means input() is unavailable.
let currentInput: SharedArrayBuffer | null = null;
const output = new OutputBuffer((chunks) => ctx.postMessage({ type: "output", runId: currentRunId, chunks }));

/** Called by Pyodide for each stdin read. Blocks this worker until the page answers. */
function readStdin(): string | null {
  if (!currentInput) return null;
  // The prompt input() just printed must reach the console before the field appears.
  output.flush();
  ctx.postMessage({ type: "input", runId: currentRunId });
  return readLine(currentInput);
}

function writer(stream: OutputStream) {
  const decoder = new TextDecoder();
  return {
    isatty: false,
    write(bytes: Uint8Array): number {
      output.write(stream, decoder.decode(bytes, { stream: true }));
      return bytes.length;
    },
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function boot(): Promise<{ pyodide: PyodideInterface; harness: Harness }> {
  const { loadPyodide } = (await import(/* @vite-ignore */ `${PYODIDE_INDEX_URL}pyodide.mjs`)) as typeof import("pyodide");
  const pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX_URL });
  pyodide.setStdout(writer("stdout"));
  pyodide.setStderr(writer("stderr"));
  pyodide.setStdin({ stdin: readStdin });
  return { pyodide, harness: loadHarness(pyodide) };
}

const runtime = boot();
runtime.then(
  () => ctx.postMessage({ type: "ready" }),
  (error) => ctx.postMessage({ type: "fatal", message: describe(error) }),
);

ctx.onmessage = async (event) => {
  if (event.data.type !== "run") return;
  const { runId, code, input } = event.data;
  currentRunId = runId;
  currentInput = input;
  const startedAt = performance.now();
  try {
    const { pyodide, harness } = await runtime;
    const exitCode = await runProgram(
      pyodide,
      harness,
      code,
      (message) => ctx.postMessage({ type: "status", runId, message }),
      input !== null,
    );
    output.flush();
    ctx.postMessage({ type: "done", runId, exitCode, durationMs: performance.now() - startedAt });
  } catch (error) {
    // Python exceptions are handled inside the harness; reaching here means the interpreter broke.
    output.flush();
    ctx.postMessage({ type: "crashed", runId, message: describe(error) });
  }
};
