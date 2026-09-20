import type { PyodideInterface } from "pyodide";
import { runProgram, type Harness } from "./harness";
import type { CaseResult, TestInput } from "./protocol";

/** Per stream, per case. Past this the rest of the output is dropped and the result says so. */
export const CAPTURE_LIMIT = 64 * 1024;

/** Reads a case's input a line at a time, then EOF. A trailing newline does not add a line. */
export function scriptedStdin(input: string): () => string | null {
  const lines = input.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return () => (lines.length > 0 ? lines.shift()! : null);
}

/** Collects one stream of one case, up to CAPTURE_LIMIT characters. */
class Capture {
  text = "";
  truncated = false;
  private readonly decoder = new TextDecoder();
  readonly writer = {
    isatty: false,
    write: (bytes: Uint8Array): number => {
      this.append(this.decoder.decode(bytes, { stream: true }));
      return bytes.length;
    },
  };

  finish(): void {
    this.append(this.decoder.decode());
  }

  private append(chunk: string): void {
    if (this.truncated || chunk === "") return;
    const room = CAPTURE_LIMIT - this.text.length;
    if (chunk.length >= room) {
      this.text += chunk.slice(0, room);
      this.truncated = true;
    } else {
      this.text += chunk;
    }
  }
}

/**
 * Runs `code` once per case, with that case's input as stdin and its output captured.
 *
 * Lives outside the worker so it can run against the real Pyodide in Node. `restore` puts
 * the caller's own streams back afterwards, whatever happens.
 */
export async function runCases(
  pyodide: PyodideInterface,
  harness: Harness,
  code: string,
  cases: TestInput[],
  post: (result: CaseResult) => void,
  report: (message: string) => void,
  restore: () => void,
): Promise<void> {
  try {
    for (const testCase of cases) {
      const stdout = new Capture();
      const stderr = new Capture();
      pyodide.setStdout(stdout.writer);
      pyodide.setStderr(stderr.writer);
      pyodide.setStdin({ stdin: scriptedStdin(testCase.input) });
      const startedAt = performance.now();
      const exitCode = await runProgram(pyodide, harness, code, report, true);
      stdout.finish();
      stderr.finish();
      post({
        id: testCase.id,
        stdout: stdout.text,
        stderr: stderr.text,
        exitCode,
        durationMs: performance.now() - startedAt,
        truncated: stdout.truncated || stderr.truncated,
      });
    }
  } finally {
    restore();
  }
}
