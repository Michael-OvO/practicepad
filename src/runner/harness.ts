import type { PyodideInterface } from "pyodide";
import harnessSource from "./harness.py?raw";

export interface Harness {
  findMissingImports(code: string): string[];
  installMissing(names: string[], report: (message: string) => void): Promise<void>;
  runMain(code: string, interactive: boolean): number;
}

type PyFunction = (...args: unknown[]) => unknown;

interface PyNamespace {
  get(name: string): PyFunction;
}

interface PyList {
  toJs(): string[];
  destroy(): void;
}

/** Executes harness.py in its own namespace and exposes its functions to JavaScript. */
export function loadHarness(pyodide: PyodideInterface): Harness {
  const namespace = pyodide.globals.get("dict")() as PyNamespace;
  pyodide.runPython(harnessSource, { globals: namespace as never, filename: "harness.py" });
  const findMissing = namespace.get("find_missing_imports");
  const installMissing = namespace.get("install_missing");
  const runMain = namespace.get("run_main");

  return {
    findMissingImports(code) {
      const result = findMissing(code) as PyList;
      try {
        return result.toJs();
      } finally {
        result.destroy();
      }
    },
    async installMissing(names, report) {
      await (installMissing(names, report) as PromiseLike<unknown>);
    },
    runMain: (code, interactive) => runMain(code, interactive) as number,
  };
}

const ignore = () => {};

/** Makes the program's imports available, runs it, and returns its exit code. */
export async function runProgram(
  pyodide: PyodideInterface,
  harness: Harness,
  code: string,
  report: (message: string) => void,
  interactive = false,
): Promise<number> {
  if (harness.findMissingImports(code).length > 0) {
    try {
      await pyodide.loadPackagesFromImports(code, {
        messageCallback: (message) => {
          if (message.startsWith("Loading ")) report(`${message}…`);
        },
        errorCallback: ignore,
      });
      const stillMissing = harness.findMissingImports(code);
      if (stillMissing.length > 0) {
        await pyodide.loadPackage("micropip", { messageCallback: ignore, errorCallback: ignore });
        await harness.installMissing(stillMissing, report);
      }
    } catch (error) {
      // Offline or CDN trouble: run anyway so the user sees Python's own ImportError.
      report(`Could not load packages: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return harness.runMain(code, interactive);
}
