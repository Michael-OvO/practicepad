# Test cases — design

A LeetCode-style test case panel: each case is an input (fed to the program as
stdin) and an expected output; **Run tests** runs the program once per case and
reports pass/fail. Builds on the interactive stdin work
(`2026-09-18-stdin-and-lazy-python-design.md`); the console, the pads model and
the runner protocol described there hold unless amended below.

## Why

Interview problems are usually checked against several inputs. Typing them into
the console one run at a time, then comparing output by eye, is slow and error
prone. Cases saved with the pad make re-running after every edit one keystroke.

## Behaviour

A third tab in the right pane: **Program Output | Test cases | Notes**.

- **Chips** across the top, one per case (`Case 1`, `Case 2`, …) with a verdict
  mark once run (`✓` passed, `✗` failed or error, `·` not run), plus **+** to add
  a case. Clicking a chip selects it. A pad with no cases shows a short hint and
  the add button.
- **The selected case** shows an **Input** textarea and an **Expected output**
  textarea, editable at any time. After a run it also shows **Actual output**
  beside Expected, stderr (for example a traceback) beneath it when there is
  any, and a status line: `Passed · 12 ms`, `Failed · 12 ms`,
  `Error · exit code 1 · 12 ms`, `Ran · 12 ms` (no expectation), `Running…`, or
  `Not run`. A **Delete case** button removes the selected case.
- **Run tests** at the bottom runs every case of the current pad, in order,
  against the current code; while it runs the button becomes **Stop**. A summary
  beside it reads `2 of 3 passed` (cases without an expectation are not
  counted: `1 of 2 passed, 1 ran`). Cases are also runnable from the palette
  (**Run test cases**) and with Cmd/Ctrl+Shift+Enter; both switch the right pane
  to the tab. Plain Run keeps running the program in the console.
- A case whose **Expected output is empty** has no expectation: it shows its
  output and reads `Ran`, never pass or fail. This makes a case a quick fixed
  stdin.
- Test runs never touch the console: nothing is cleared or printed there, and
  no input field appears — a program that reads past its input gets `EOFError`.
  Package loading messages during a test run show in the summary line instead.
- Stop terminates the run as for any program; cases not yet reported show
  `Not run`. The Run button in the editor toolbar is disabled while tests run,
  as it is for any run.
- Results are runtime state: they are replaced by the next run and are not
  saved. Switching pads and back shows the last results for that pad's cases.

## Data

```ts
interface TestCase {
  id: string; // crypto.randomUUID()
  input: string;
  expected: string;
}
interface Pad {
  /* … */
  tests: TestCase[];
}
```

`padStore` gains `addTest(state, padId, now?, id?)`, `updateTest(state, padId,
testId, patch: { input?: string; expected?: string }, now?)` and
`removeTest(state, padId, testId, now?)`, all bumping `updatedAt`. Pads saved
before this load with `tests: []`; malformed entries are dropped. Adding and
removing go through `PadSession.apply`; typing in a case's textareas goes through
`PadSession.edit`, so it costs no render of the app — the textareas are
uncontrolled and keyed by case id, seeded from the live session like code and
notes.

## Execution

`RunnerController.runTests(code, cases)` is gated like `run`: allowed in `idle`
(spawns, prints `Loading Python… (first run only)` to the console, queues),
`loading` (replaces the queue) and `ready`; ignored otherwise. The queue holds
either a program run or a test run. Status becomes `running`.

Protocol additions:

- Main → worker: `{ type: "test", runId, code, cases: { id, input }[] }`.
- Worker → main: `{ type: "case", runId, id, stdout, stderr, exitCode,
  durationMs, truncated }` once per case, in order; then the usual
  `{ type: "done", runId, exitCode: 0, durationMs }`. `status` messages (package
  loading) are sent as today.

Worker, per case: stdin becomes a reader that yields the case's input line by
line then EOF (the input is split on `\n`; a trailing newline does not add an
empty line); stdout and stderr are swapped for string capture, each capped at
64 KiB (`truncated: true`, further output dropped); the program runs through
`runProgram(…, interactive = true)`; the result is posted. After the batch the
console writers and the interactive stdin reader are restored.

Controller: in a test run, `status` messages go to a new event
`testMessage(message)`; `case` messages to `caseResult(result)`; `done` to
`testsFinished()` with status `ready` and no console line; `stop()` and a crash
end the run through `testsFinished()` too (a crash still prints to the console,
as today). `awaitingInput` never fires during a test run.

Hook: `usePythonRunner` exposes `testRun: { running: boolean; message: string
| null; results: Record<string, CaseResult> }`, `runTests(code, cases)`. Starting
a run resets `results` for the ids in the run; a case not reported by the end
stays absent (shown as `Not run`).

## Comparison

`src/runner/judge.ts`:

- `normalizeOutput(text)`: strip trailing whitespace from every line, drop
  trailing blank lines. Nothing else changes: case, internal spacing and
  leading whitespace count.
- `judge(result, expected)`: `error` when `exitCode !== 0`; else `ran` when
  `expected.trim() === ""`; else `passed` when
  `normalizeOutput(result.stdout) === normalizeOutput(expected)`, otherwise
  `failed`.

## Code structure

- `src/pads/padStore.ts` — `TestCase`, `tests` on `Pad`, the three transitions,
  legacy loading.
- `src/pads/usePads.ts` — `addTest`, `updateTest`, `removeTest`.
- `src/runner/protocol.ts` — `test` request, `case` response, `CaseResult`.
- `src/runner/judge.ts` — pure comparison.
- `src/runner/runnerController.ts` — `runTests`, test-mode routing.
- `src/runner/pyodide.worker.ts` — batch execution with capture.
- `src/runner/usePythonRunner.ts` — `testRun`, `runTests`.
- `src/components/TestCasesPanel.tsx` — the tab's UI.
- `src/components/RightPane.tsx` — third tab; arrow keys cycle all tabs.
- `src/App.tsx` — wiring, palette command, shortcut; `CodeEditor` claims
  Cmd/Ctrl+Shift+Enter inside Monaco.

## Testing

- **Unit (Vitest):** `padStore` add/update/remove, legacy pads load with
  `tests: []`, malformed cases dropped; `judge` (trailing whitespace ignored,
  internal spacing not, error beats output, empty expectation reads `ran`);
  `RunnerController.runTests` (message shape, `case` → `caseResult`, `done` →
  `testsFinished` without a console line, Stop mid-batch finishes the run, stale
  `runId` ignored, queued from `idle`).
- **Integration (Vitest, Node):** the worker's batch logic lives in a function
  `runCases(pyodide, harness, code, cases, post)` exported from
  `src/runner/testBatch.ts` so it can run against real Pyodide: two cases with
  different stdin give different stdout; reading past the input gives
  `EOFError` and exit 1; output is capped and flagged; stdout/stderr writers are
  restored afterwards.
- **E2E (Playwright):** add two cases to a summing program, Run tests → one
  passes, one fails with the actual output shown; fix the expectation, re-run →
  both pass; cases survive a reload; Cmd/Ctrl+Shift+Enter runs them.
- README gains a "Test cases" bullet.
