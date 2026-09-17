import type { PyodideInterface } from "pyodide";
import { loadHarness, runProgram, type Harness } from "./harness";
import { OutputBuffer } from "./outputBuffer";
import { PYODIDE_INDEX_URL, type OutputStream, type WorkerRequest, type WorkerResponse } from "./protocol";

// Typed by hand: the DOM and WebWorker TypeScript libs conflict when both are loaded.
const ctx = self as unknown as {
  postMessage(message: WorkerResponse): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

let currentRunId = 0;
const output = new OutputBuffer((chunks) => ctx.postMessage({ type: "output", runId: currentRunId, chunks }));

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
  return { pyodide, harness: loadHarness(pyodide) };
}

const runtime = boot();
runtime.then(
  () => ctx.postMessage({ type: "ready" }),
  (error) => ctx.postMessage({ type: "fatal", message: describe(error) }),
);

ctx.onmessage = async (event) => {
  const { runId, code } = event.data;
  currentRunId = runId;
  const startedAt = performance.now();
  try {
    const { pyodide, harness } = await runtime;
    const exitCode = await runProgram(pyodide, harness, code, (message) =>
      ctx.postMessage({ type: "status", runId, message }),
    );
    output.flush();
    ctx.postMessage({ type: "done", runId, exitCode, durationMs: performance.now() - startedAt });
  } catch (error) {
    // Python exceptions are handled inside the harness; reaching here means the interpreter broke.
    output.flush();
    ctx.postMessage({ type: "crashed", runId, message: describe(error) });
  }
};
