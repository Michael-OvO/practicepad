import { loadPyodide, type PyodideInterface } from "pyodide";
import { beforeAll, describe, expect, it } from "vitest";
import { loadHarness, runProgram, type Harness } from "../src/runner/harness";
import { PYODIDE_VERSION, type CaseResult } from "../src/runner/protocol";
import { CAPTURE_LIMIT, runCases } from "../src/runner/testBatch";

let pyodide: PyodideInterface;
let harness: Harness;
let stdout = "";
let stderr = "";

function capture(sink: (text: string) => void) {
  const decoder = new TextDecoder();
  return {
    isatty: false,
    write(bytes: Uint8Array) {
      sink(decoder.decode(bytes, { stream: true }));
      return bytes.length;
    },
  };
}

type Script = (string | null)[];

/** Runs `code`; `script` answers stdin reads in order (null = EOF), and undefined means no stdin. */
async function run(code: string, script?: Script) {
  stdout = "";
  stderr = "";
  const statuses: string[] = [];
  const lines = script ? [...script] : [];
  pyodide.setStdin({ stdin: () => (lines.length > 0 ? lines.shift()! : null) });
  const exitCode = await runProgram(pyodide, harness, code, (message) => statuses.push(message), script !== undefined);
  return { exitCode, stdout, stderr, statuses };
}

beforeAll(async () => {
  pyodide = await loadPyodide();
  pyodide.setStdout(capture((text) => (stdout += text)));
  pyodide.setStderr(capture((text) => (stderr += text)));
  harness = loadHarness(pyodide);
});

describe("python harness", () => {
  it("runs against the Pyodide version the app loads from the CDN", () => {
    expect(pyodide.version).toBe(PYODIDE_VERSION);
  });

  it("captures stdout, including a final line without a newline", async () => {
    const result = await run('print("hello")\nprint("partial", end="")');
    expect(result).toMatchObject({ exitCode: 0, stdout: "hello\npartial", stderr: "" });
  });

  it("runs as __main__ with a fresh namespace every time", async () => {
    await run("leak = 42");
    const result = await run('if __name__ == "__main__":\n    print("leak" in globals())');
    expect(result.stdout).toBe("False\n");
  });

  it("prints tracebacks that start at main.py", async () => {
    const result = await run("def f(x):\n    return 1 / x\n\nf(0)");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Traceback (most recent call last):\n  File "main.py", line 4, in <module>\n    f(0)');
    expect(result.stderr).toContain('  File "main.py", line 2, in f\n    return 1 / x');
    expect(result.stderr).toContain("ZeroDivisionError: division by zero");
    expect(result.stderr).not.toContain("harness.py");
  });

  it("reports syntax errors the way the python command does", async () => {
    const result = await run('x = (1,\nprint("hi"');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^ {2}File "main\.py", line 2\n/);
    expect(result.stderr).toContain("SyntaxError: '(' was never closed");
    expect(result.stderr).not.toContain("Traceback");
  });

  it("honours sys.exit", async () => {
    expect(await run('import sys\nprint("before")\nsys.exit(3)')).toMatchObject({ exitCode: 3, stdout: "before\n", stderr: "" });
    expect(await run('import sys\nsys.exit("fatal: nope")')).toMatchObject({ exitCode: 1, stderr: "fatal: nope\n" });
  });

  it("lets unittest.main() discover tests defined in the pad", async () => {
    const result = await run(
      [
        "import unittest",
        "",
        "class T(unittest.TestCase):",
        "    def test_ok(self):",
        "        self.assertEqual(1 + 1, 2)",
        "    def test_bad(self):",
        "        self.assertEqual(1, 2)",
        "",
        "unittest.main()",
      ].join("\n"),
    );
    expect(result.stderr).toContain("Ran 2 tests");
    expect(result.stderr).toContain("FAILED (failures=1)");
    expect(result.exitCode).toBe(1);
  });

  it("recovers when a previous run replaced sys.stdout", async () => {
    await run("import sys, io\nsys.stdout = io.StringIO()\nprint('swallowed')");
    expect((await run("print('visible')")).stdout).toBe("visible\n");
  });

  it("feeds input() from stdin, prompt included in stdout", async () => {
    const result = await run('name = input("name? ")\nprint("Hello,", name)', ["Ada"]);
    expect(result).toMatchObject({ exitCode: 0, stdout: "name? Hello, Ada\n", stderr: "" });
  });

  it("raises EOFError from input() at end-of-file", async () => {
    const result = await run("input()", []);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("EOFError");
  });

  it("reads sys.stdin to EOF, then lets a later input() read again", async () => {
    const result = await run("import sys\nprint(repr(sys.stdin.read()))\nprint(input())", ["a", "b", null, "c"]);
    expect(result).toMatchObject({ exitCode: 0, stdout: "'a\\nb\\n'\nc\n" });
  });

  it("explains why input() is unavailable when the page cannot share memory", async () => {
    const result = await run('name = input("name? ")');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("RuntimeError: input() is not available: this page is not cross-origin isolated");
  });

  it("finds imports that are not installed, ignoring relative imports and broken code", () => {
    expect(harness.findMissingImports("import os, json\nfrom collections import deque")).toEqual([]);
    expect(harness.findMissingImports("import zzz_missing.sub\nfrom . import sibling\nfrom yyy_missing import x")).toEqual([
      "yyy_missing",
      "zzz_missing",
    ]);
    expect(harness.findMissingImports("import (")).toEqual([]);
  });

  it("loads packages bundled with Pyodide on first import", async () => {
    const result = await run("import numpy as np\nprint(np.arange(6).reshape(2, 3).sum(axis=0))");
    expect(result.statuses).toContain("Loading numpy…");
    expect(result).toMatchObject({ exitCode: 0, stdout: "[3 5 7]\n", stderr: "" });
  });

  it("installs pure-Python packages from PyPI without leaking loader logs into stdout", async () => {
    const result = await run('import cowsay\ncowsay.cow("moo")');
    expect(result.statuses).toContain("Installing cowsay from PyPI…");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("| moo |");
    expect(result.stdout).not.toContain("micropip");
  });

  it("still runs the program when a package cannot be installed", async () => {
    const result = await run("import definitely_not_a_real_pkg_xyz");
    expect(result.statuses.some((message) => message.startsWith("Could not install definitely_not_a_real_pkg_xyz"))).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("ModuleNotFoundError: No module named 'definitely_not_a_real_pkg_xyz'");
  });

  describe("runCases", () => {
    // Puts this file's own capture writers back, the way the worker restores its console writers.
    const restoreCapture = () => {
      pyodide.setStdout(capture((text) => (stdout += text)));
      pyodide.setStderr(capture((text) => (stderr += text)));
    };

    async function batch(code: string, inputs: string[]) {
      const results: CaseResult[] = [];
      const cases = inputs.map((input, index) => ({ id: `c${index}`, input }));
      await runCases(pyodide, harness, code, cases, (result) => results.push(result), () => {}, restoreCapture);
      return results;
    }

    it("runs the program once per case with that case's stdin", async () => {
      const results = await batch("n = int(input())\nprint(n * 2)", ["2\n", "21"]);
      expect(results.map((result) => [result.id, result.stdout, result.exitCode])).toEqual([
        ["c0", "4\n", 0],
        ["c1", "42\n", 0],
      ]);
    });

    it("gives EOFError when a case reads past its input", async () => {
      const [result] = await batch("input()\ninput()", ["only one line"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("EOFError");
    });

    it("caps captured output and says so", async () => {
      const [result] = await batch('print("x" * 100000)', [""]);
      expect(result.truncated).toBe(true);
      expect(result.stdout.length).toBe(CAPTURE_LIMIT);
    });

    it("restores the previous streams afterwards", async () => {
      await batch('print("in batch")', [""]);
      expect((await run('print("after")')).stdout).toBe("after\n");
    });
  });
});
