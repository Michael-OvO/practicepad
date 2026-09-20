# Test Cases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Test cases" tab where each case is a stdin input plus an expected stdout; Run tests runs the program once per case in the worker and reports pass/fail.

**Architecture:** Cases live on the `Pad` (`tests: TestCase[]`) and go through `PadSession` like code and notes. `RunnerController.runTests` posts one `test` message; the worker runs every case with a scripted stdin and captured stdout/stderr (`src/runner/testBatch.ts`, Node-testable) and posts a `case` result each. `src/runner/judge.ts` compares; `TestCasesPanel` renders.

**Tech Stack:** React 19, Vite 8, Pyodide 314.0.7, Vitest 5, Playwright 1.63.

Spec: `docs/superpowers/specs/2026-09-20-test-cases-design.md`.

## Global Constraints

- Capture cap per stream per case: 64 KiB, then `truncated: true`.
- Comparison: strip trailing whitespace on every line, drop trailing blank lines; nothing else.
- Verdicts: `error` (exit code ≠ 0) > `ran` (empty expectation) > `passed` / `failed`.
- Status-line copy: `Passed · 12 ms`, `Failed · 12 ms`, `Error · exit code 1 · 12 ms`, `Ran · 12 ms`, `Running…`, `Not run`. Summary: `2 of 3 passed`, `1 of 2 passed, 1 ran`.
- Shortcut: Cmd/Ctrl+Shift+Enter; label `⇧⌘↵` / `Ctrl+Shift+↵`. Palette command title: `Run test cases`.
- `npx tsc --noEmit && npx vitest run` clean before every commit.

---

### Task 1: Test cases on the pad

**Files:** Modify `src/pads/padStore.ts`, `src/pads/usePads.ts`; Test `src/pads/padStore.test.ts`.

**Produces:** `TestCase { id; input; expected }`; `Pad.tests: TestCase[]`; `addTest(state, padId, now?, id?)`, `updateTest(state, padId, testId, patch: { input?: string; expected?: string }, now?)`, `removeTest(state, padId, testId, now?)`; `usePads()` returns `addTest(padId, id)`, `updateTest(padId, testId, patch)`, `removeTest(padId, testId)`.

- [ ] Tests (add to `padStore.test.ts`; update the `initialState` expectation and the legacy-load expectation to include `tests: []`):

```ts
describe("test cases", () => {
  it("adds an empty case and bumps updatedAt", () => {
    const state = addTest(initialState(1, "a"), "a", 40, "t1");
    expect(activePad(state)).toMatchObject({ tests: [{ id: "t1", input: "", expected: "" }], updatedAt: 40 });
  });

  it("patches one field of one case", () => {
    let state = addTest(initialState(1, "a"), "a", 2, "t1");
    state = addTest(state, "a", 3, "t2");
    state = updateTest(state, "a", "t2", { input: "3\n" }, 50);
    expect(activePad(state).tests).toEqual([
      { id: "t1", input: "", expected: "" },
      { id: "t2", input: "3\n", expected: "" },
    ]);
    expect(activePad(state).updatedAt).toBe(50);
  });

  it("removes a case", () => {
    let state = addTest(initialState(1, "a"), "a", 2, "t1");
    state = removeTest(state, "a", "t1", 60);
    expect(activePad(state)).toMatchObject({ tests: [], updatedAt: 60 });
  });

  it("ignores unknown pads and cases", () => {
    const state = addTest(initialState(1, "a"), "a", 2, "t1");
    expect(updateTest(state, "a", "nope", { input: "x" })).toBe(state);
    expect(removeTest(state, "a", "nope")).toBe(state);
    expect(addTest(state, "nope")).toBe(state);
  });

  it("loads pads saved before test cases existed, and drops malformed cases", () => {
    const legacy = { id: "old", title: "Old", code: "pass", notes: "", createdAt: 1, updatedAt: 2 };
    const messy = { ...legacy, id: "messy", tests: [{ id: "ok", input: "1", expected: "2" }, { id: 3 }, "junk"] };
    const state = loadState(fakeStorage({ [PADS_KEY]: JSON.stringify([legacy, messy]) }), 5, "n");
    expect(state.pads[0].tests).toEqual([]);
    expect(state.pads[1].tests).toEqual([{ id: "ok", input: "1", expected: "2" }]);
  });
});
```

- [ ] Run `npx vitest run src/pads/padStore.test.ts` — FAIL (`addTest` not exported).
- [ ] Implement in `padStore.ts`:

```ts
export interface TestCase {
  id: string;
  /** Fed to the program as stdin. */
  input: string;
  /** Compared with stdout; empty means "just show me the output". */
  expected: string;
}
// Pad gains: tests: TestCase[]   (newPad sets tests: [])

function patchTests(state: PadState, padId: string, update: (tests: TestCase[]) => TestCase[], now: number): PadState {
  const pad = state.pads.find((candidate) => candidate.id === padId);
  if (!pad) return state;
  return patchPad(state, padId, { tests: update(pad.tests) }, now);
}

export function addTest(state: PadState, padId: string, now: number = Date.now(), id: string = crypto.randomUUID()): PadState {
  return patchTests(state, padId, (tests) => [...tests, { id, input: "", expected: "" }], now);
}

export function updateTest(state, padId, testId, patch: Partial<Pick<TestCase, "input" | "expected">>, now = Date.now()): PadState {
  const pad = state.pads.find((candidate) => candidate.id === padId);
  if (!pad?.tests.some((test) => test.id === testId)) return state;
  return patchTests(state, padId, (tests) => tests.map((test) => (test.id === testId ? { ...test, ...patch } : test)), now);
}

export function removeTest(state, padId, testId, now = Date.now()): PadState {
  const pad = state.pads.find((candidate) => candidate.id === padId);
  if (!pad?.tests.some((test) => test.id === testId)) return state;
  return patchTests(state, padId, (tests) => tests.filter((test) => test.id !== testId), now);
}

function isTestCase(value: unknown): value is TestCase {
  if (typeof value !== "object" || value === null) return false;
  const test = value as Record<string, unknown>;
  return typeof test.id === "string" && typeof test.input === "string" && typeof test.expected === "string";
}
// isPad: accept tests undefined or an array; loadState maps
//   tests: Array.isArray(pad.tests) ? pad.tests.filter(isTestCase) : []
```

`usePads.ts`: `addTest = (padId, id) => session.apply(s => addTestStore(s, padId, Date.now(), id))`; `updateTest = (padId, testId, patch) => session.edit(padId, s => updateTestStore(s, padId, testId, patch))`; `removeTest = (padId, testId) => session.apply(s => removeTestStore(s, padId, testId))`.

- [ ] `npx tsc --noEmit && npx vitest run` clean. Commit: `Keep test cases on the pad`.

---

### Task 2: Protocol and judge

**Files:** Modify `src/runner/protocol.ts`; Create `src/runner/judge.ts`; Test `src/runner/judge.test.ts`.

**Produces:** `TestInput { id; input }`, `CaseResult { id; stdout; stderr; exitCode; durationMs; truncated }`, request `{ type: "test"; runId; code; cases: TestInput[] }`, response `{ type: "case"; runId } & CaseResult`; `Verdict`, `normalizeOutput(text)`, `judge(result, expected)`, `summarizeVerdicts(verdicts)`.

- [ ] Tests (`judge.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { judge, normalizeOutput, summarizeVerdicts } from "./judge";

const result = (stdout: string, exitCode = 0) => ({ stdout, exitCode });

describe("normalizeOutput", () => {
  it("ignores trailing whitespace on lines and trailing blank lines, nothing else", () => {
    expect(normalizeOutput("a  \nb\t\n\n\n")).toBe("a\nb");
    expect(normalizeOutput("  a\n b")).toBe("  a\n b");
    expect(normalizeOutput("a\r\n")).toBe("a");
  });
});

describe("judge", () => {
  it("passes on a match after normalisation", () => {
    expect(judge(result("42\n"), "42")).toBe("passed");
  });
  it("fails on different text, including case and internal spacing", () => {
    expect(judge(result("42"), "43")).toBe("failed");
    expect(judge(result("a b"), "a  b")).toBe("failed");
    expect(judge(result("Yes"), "yes")).toBe("failed");
  });
  it("reports an error regardless of output when the exit code is not zero", () => {
    expect(judge(result("42", 1), "42")).toBe("error");
  });
  it("only ran when there is no expectation", () => {
    expect(judge(result("anything"), "  \n")).toBe("ran");
  });
});

describe("summarizeVerdicts", () => {
  it("counts judged cases, and mentions the ones that only ran", () => {
    expect(summarizeVerdicts(["passed", "failed", "passed"])).toBe("2 of 3 passed");
    expect(summarizeVerdicts(["passed", "error", "ran"])).toBe("1 of 2 passed, 1 ran");
    expect(summarizeVerdicts(["ran"])).toBe("1 ran");
    expect(summarizeVerdicts([])).toBe("");
  });
});
```

- [ ] FAIL (module missing). Implement `judge.ts`:

```ts
import type { CaseResult } from "./protocol";

export type Verdict = "passed" | "failed" | "error" | "ran";

/** Trailing whitespace per line and trailing blank lines do not count; everything else does. */
export function normalizeOutput(text: string): string {
  const lines = text.split("\n").map((line) => line.replace(/[ \t\r\f\v]+$/, ""));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

export function judge(result: Pick<CaseResult, "stdout" | "exitCode">, expected: string): Verdict {
  if (result.exitCode !== 0) return "error";
  if (expected.trim() === "") return "ran";
  return normalizeOutput(result.stdout) === normalizeOutput(expected) ? "passed" : "failed";
}

export function summarizeVerdicts(verdicts: Verdict[]): string {
  const ran = verdicts.filter((verdict) => verdict === "ran").length;
  const judged = verdicts.length - ran;
  const passed = verdicts.filter((verdict) => verdict === "passed").length;
  const parts: string[] = [];
  if (judged > 0) parts.push(`${passed} of ${judged} passed`);
  if (ran > 0) parts.push(`${ran} ran`);
  return parts.join(", ");
}
```

`protocol.ts` additions as in Produces (`WorkerRequest` becomes a union of the `run` and `test` shapes).

- [ ] Clean; commit `Add the test protocol and the output judge`.

---

### Task 3: Batch execution in the worker

**Files:** Create `src/runner/testBatch.ts`; Modify `src/runner/pyodide.worker.ts`; Test `tests/harness.integration.test.ts`.

**Produces:** `CAPTURE_LIMIT`, `scriptedStdin(input): () => string | null`, `runCases(pyodide, harness, code, cases, post, report, restore): Promise<void>`.

- [ ] Integration tests (append a `describe("runCases")` to the integration file; `restoreCapture` re-installs the file's capture writers):

```ts
describe("runCases", () => {
  const restoreCapture = () => {
    pyodide.setStdout(capture((text) => (stdout += text)));
    pyodide.setStderr(capture((text) => (stderr += text)));
  };
  async function batch(code: string, inputs: string[]) {
    const results: CaseResult[] = [];
    await runCases(pyodide, harness, code, inputs.map((input, index) => ({ id: `c${index}`, input })), (r) => results.push(r), () => {}, restoreCapture);
    return results;
  }

  it("runs the program once per case with that case's stdin", async () => {
    const results = await batch("n = int(input())\nprint(n * 2)", ["2\n", "21"]);
    expect(results.map((r) => [r.id, r.stdout, r.exitCode])).toEqual([["c0", "4\n", 0], ["c1", "42\n", 0]]);
  });

  it("gives EOFError when a case reads past its input", async () => {
    const [r] = await batch("input()\ninput()", ["only one line"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("EOFError");
  });

  it("caps captured output and says so", async () => {
    const [r] = await batch('print("x" * 100000)', [""]);
    expect(r.truncated).toBe(true);
    expect(r.stdout.length).toBe(CAPTURE_LIMIT);
  });

  it("restores the previous streams afterwards", async () => {
    await batch('print("in batch")', [""]);
    expect((await run('print("after")')).stdout).toBe("after\n");
  });
});
```

- [ ] FAIL (module missing). Implement `testBatch.ts`:

```ts
import type { PyodideInterface } from "pyodide";
import { runProgram, type Harness } from "./harness";
import type { CaseResult, TestInput } from "./protocol";

export const CAPTURE_LIMIT = 64 * 1024;

/** Reads a case's input a line at a time, then EOF. A trailing newline does not add a line. */
export function scriptedStdin(input: string): () => string | null {
  const lines = input.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return () => (lines.length > 0 ? lines.shift()! : null);
}

/** Collects one stream of a case, up to CAPTURE_LIMIT characters. */
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
  finish(): void { this.append(this.decoder.decode()); }
  private append(chunk: string): void {
    if (this.truncated || chunk === "") return;
    const room = CAPTURE_LIMIT - this.text.length;
    if (chunk.length >= room) { this.text += chunk.slice(0, room); this.truncated = true; }
    else this.text += chunk;
  }
}

/**
 * Runs `code` once per case, with that case's input as stdin and its output captured.
 * `restore` puts the caller's streams back afterwards, whatever happens.
 */
export async function runCases(pyodide, harness, code, cases, post, report, restore): Promise<void> {
  try {
    for (const testCase of cases) {
      const stdout = new Capture();
      const stderr = new Capture();
      pyodide.setStdout(stdout.writer);
      pyodide.setStderr(stderr.writer);
      pyodide.setStdin({ stdin: scriptedStdin(testCase.input) });
      const startedAt = performance.now();
      const exitCode = await runProgram(pyodide, harness, code, report, true);
      stdout.finish(); stderr.finish();
      post({ id: testCase.id, stdout: stdout.text, stderr: stderr.text, exitCode, durationMs: performance.now() - startedAt, truncated: stdout.truncated || stderr.truncated });
    }
  } finally {
    restore();
  }
}
```

Worker: `ctx.onmessage` dispatches on `event.data.type`; `test` → `runId`/`currentInput = null`, `await runCases(..., (result) => post({ type: "case", runId, ...result }), (message) => post({ type: "status", runId, message }), () => { pyodide.setStdout(writer("stdout")); pyodide.setStderr(writer("stderr")); pyodide.setStdin({ stdin: readStdin }); })`, then `done` with `exitCode: 0`; errors → `crashed`.

- [ ] Clean (integration suite ~40 s); commit `Run test cases as a batch in the worker`.

---

### Task 4: Controller and hook

**Files:** Modify `src/runner/runnerController.ts`, `src/runner/usePythonRunner.ts`; Test `src/runner/runnerController.test.ts`.

**Produces:** `RunnerEvents` gains `caseResult(result: CaseResult)`, `testsFinished()`, `testMessage(message: string)`; `RunnerController.runTests(code, cases: TestInput[]): boolean`; hook returns `testRun: TestRunState` and `runTests(code, cases: TestCase[])`.

- [ ] Tests (extend `setup()` with `caseResults: CaseResult[]`, `finished: number`, `testMessages: string[]` recorders; add):

```ts
describe("test runs", () => {
  it("posts the batch, forwards each result, and finishes without touching the console", () => {
    const t = setup();
    const worker = t.running();
    worker.send({ type: "done", runId: 1, exitCode: 0, durationMs: 1 });
    const textsBefore = t.texts.length;
    expect(t.controller.runTests("code", [{ id: "a", input: "1" }])).toBe(true);
    expect(t.lastStatus()).toBe("running");
    expect(worker.posted[1]).toEqual({ type: "test", runId: 2, code: "code", cases: [{ id: "a", input: "1" }] });
    worker.send({ type: "case", runId: 2, id: "a", stdout: "2\n", stderr: "", exitCode: 0, durationMs: 3, truncated: false });
    expect(t.caseResults.map((r) => r.id)).toEqual(["a"]);
    worker.send({ type: "done", runId: 2, exitCode: 0, durationMs: 5 });
    expect(t.finished).toBe(1);
    expect(t.lastStatus()).toBe("ready");
    expect(t.texts).toHaveLength(textsBefore);
    expect(t.clears()).toBe(1);
  });

  it("routes package messages to the panel, not the console", () => { /* status during a test run → testMessages, texts unchanged */ });
  it("stopping a test run finishes it without a console line", () => { /* stop → finished 1, texts unchanged, workers 2 */ });
  it("ignores results from an earlier test run", () => { /* case with runId 1 after run 2 started → caseResults empty */ });
  it("queues a test run from idle and runs it once Python is ready", () => { /* fresh → runTests true, loading line, ready → posted test */ });
  it("declines a test run while something is running", () => { /* running() then runTests → false, no post */ });
  it("finishes a queued test run when Python fails to load", () => { /* runTests from idle, fatal → finished 1, error */ });
});
```

- [ ] FAIL. Implement: `type Job = { kind: "run"; code } | { kind: "tests"; code; cases }`; `pending: Job | null`; `mode: "program" | "tests"`; `run(code)` → `request({kind:"run",code})`; `runTests(code, cases)` → `request(...)` returning whether accepted; `request` keeps `run`'s status gating (ready: clear console only for `run`); `begin(job)` posts the right message and sets `mode`; `handleMessage`: `status` → tests ? `testMessage` : `system`; `case` → `caseResult` when `mode === "tests"`; `done` → tests ? `finishTests()` : summary line; `spawn()` calls `finishTests()` when a test run is active; `stop()` skips the `Stopped.` line for tests; `giveUp` calls `testsFinished()` if `pending?.kind === "tests"`.

Hook: `TestRunState { running; message: string | null; results: Record<string, CaseResult> }`; `runTests(code, cases)` strips results for those ids, sets `running: true`, and only if `controller.runTests(...)` returns true; events update state; `testsFinished` → `running: false, message: null`.

- [ ] Clean; commit `Run test cases through the controller`.

---

### Task 5: UI, shortcut, styles, e2e, README

**Files:** Create `src/components/TestCasesPanel.tsx`; Modify `src/components/RightPane.tsx`, `src/components/CodeEditor.tsx`, `src/App.tsx`, `src/platform.ts`, `src/styles.css`, `README.md`; Test `e2e/runtime.spec.ts`.

- [ ] E2E first (append):

```ts
test("test cases run the program against fixed stdin and judge the output", async ({ page }) => {
  await seedPad(page, "n = int(input())\nprint(n * 2)\n");
  await page.goto("/");
  await page.getByRole("tab", { name: "Test cases" }).click();
  await page.getByRole("button", { name: "Add test case" }).click();
  await page.getByLabel("Test input").fill("2");
  await page.getByLabel("Expected output").fill("4");
  await page.getByRole("button", { name: "Add test case" }).click();
  await page.getByLabel("Test input").fill("5");
  await page.getByLabel("Expected output").fill("11");

  await page.getByRole("button", { name: "Run tests" }).click();
  await expect(page.getByText("1 of 2 passed")).toBeVisible();
  await expect(page.getByLabel("Actual output")).toHaveText("10");
  await expect(page.getByRole("button", { name: "Case 1" })).toContainText("✓");
  await expect(page.getByRole("button", { name: "Case 2" })).toContainText("✗");

  await page.getByLabel("Expected output").fill("10");
  await page.keyboard.press("ControlOrMeta+Shift+Enter");
  await expect(page.getByText("2 of 2 passed")).toBeVisible();

  await page.reload();
  await page.getByRole("tab", { name: "Test cases" }).click();
  await expect(page.getByRole("button", { name: "Case 2" })).toBeVisible();
  await expect(page.getByLabel("Test input")).toHaveValue("2");
});
```

- [ ] FAIL (no tab). Implement `TestCasesPanel` (props: `padId`, `tests`, `testRun`, `status`, `onAdd(id)`, `onRemove(testId)`, `onChange(testId, patch)`, `onRun()`, `onStop()`): chips with verdict marks (`✓` passed, `✗` failed/error, `·` otherwise), add button (`aria-label="Add test case"`, selects the new case), uncontrolled textareas keyed by case id (`aria-label="Test input"` / `"Expected output"`), `<pre aria-label="Actual output">`, stderr `<pre>` when present, status line (`role="status"`), `Delete case` button, footer with `Run tests`/`Stop` and the `summarizeVerdicts` text plus `testRun.message`. `RightPane`: third tab `{ id: "tests", label: "Test cases" }`, arrow keys cycle all tabs, renders a `testsPanel: ReactNode` prop. `platform.ts`: `RUN_TESTS_SHORTCUT_LABEL`. `CodeEditor`: `onRunTests` prop bound to `CtrlCmd | Shift | Enter`. `App`: `runTestsActive` (switch tab, `runner.runTests(getActive().code, getActive().tests)`), window keydown `Enter` + `shiftKey`, palette `Run test cases`, `TestCasesPanel` element passed to `RightPane`. Styles: `.tests-panel`, `.case-chips`, `.case-chip(.is-passed/.is-failed/.is-error)`, `.case-body`, `.case-columns`, `.case-field`, `.case-textarea`, `.case-output(.is-stderr)`, `.case-status`, `.tests-footer`. README bullet under features.

- [ ] `npx tsc --noEmit && npx vitest run && npx playwright test` clean; commit `Add a test cases tab`.
