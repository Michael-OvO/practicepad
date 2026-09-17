# CoderPad Simulator — Design

Date: 2026-09-17
Status: Approved

## Goal

A web app that simulates the CoderPad interview coding interface and works as a
practice playground: write Python in a real code editor, run it, see real output,
and import real packages (numpy, pandas, etc.), under interview-like time pressure.

## Decisions

| Topic | Decision |
|---|---|
| Execution engine | Pyodide 314.0.7 (CPython 3.14.2 on WebAssembly) in a Web Worker, loaded from jsDelivr. No backend. |
| Stack | Vite + React + TypeScript + Monaco editor (`@monaco-editor/react`). |
| Languages | Python only. |
| Extra features | Interview timer; multiple pads with autosave. |
| Persistence | `localStorage` only. |

## Out of scope (v1)

Other languages, question bank, interactive REPL, real-time collaboration,
drawing mode, offline use, `input()` / stdin.

## Layout

Dark CoderPad-style shell, full viewport:

- **Top bar:** sidebar toggle, editable pad title, "Python 3.14" pill, timer,
  runtime status, Run / Stop button.
- **Pad sidebar (collapsible, left):** list of pads sorted by most recently
  updated, "New pad" button, per-pad rename and delete.
- **Split pane:** Monaco editor on the left, output console on the right, with a
  draggable vertical divider. Split ratio persists in `localStorage`.
- **Output console:** monospace, stdout in default colour, stderr in red, system
  messages (installing packages, run finished, stopped) dimmed. "Clear" button.
  Auto-scrolls to the bottom unless the user has scrolled up.

Keyboard: Cmd/Ctrl+Enter runs the current pad.

## Execution

### Worker protocol

Main → worker:

- `{ type: "run", runId, code }`

Worker → main:

- `{ type: "ready" }` — Pyodide finished loading.
- `{ type: "status", runId, message }` — system line, e.g. `Loading numpy…`.
- `{ type: "output", runId, chunks }` — ordered `{ stream: "stdout" | "stderr",
  text }` chunks, so interleaving of the two streams is preserved.
- `{ type: "done", runId, exitCode, durationMs }` — run finished; `exitCode` is 1
  if the program raised, or the `sys.exit` code.
- `{ type: "crashed", runId, message }` — the interpreter itself failed during a
  run; the main thread replaces the worker.
- `{ type: "fatal", message }` — Pyodide failed to load.

Starting a run clears the console.

Messages carrying a `runId` that is not the current run are ignored by the main
thread, so output from a stopped run can never leak into the next one.

### Run semantics

Each run behaves like `python main.py` in a fresh process:

1. User code is written to `main.py` in Pyodide's virtual filesystem and
   `linecache` is invalidated, so tracebacks show real source lines.
2. Imports are resolved (see below).
3. Code is compiled with filename `main.py` and executed in a fresh globals dict
   with `__name__ == "__main__"`.
4. On an exception, the traceback is printed to stderr with harness frames
   stripped, so it starts at `File "main.py", line N`. `SystemExit` ends the run
   quietly (non-zero code reported in the status line). `SyntaxError` is reported
   in standard Python format.

`sys.modules` is kept between runs so heavy packages are not re-imported, but the
user module's globals never carry over.

### Import resolution

Before executing, the harness parses the code with `ast` and collects top-level
module names from every `import` / `from … import` (relative imports ignored).
For each name not already importable (`importlib.util.find_spec`):

1. `pyodide.loadPackagesFromImports(code)` loads anything in the Pyodide
   distribution (numpy, pandas, scipy, scikit-learn, 357 packages in total).
2. Names still unresolved are installed with `micropip.install`, using an alias
   map for known import-name/package-name mismatches (`yaml` → `pyyaml`,
   `bs4` → `beautifulsoup4`, `dateutil` → `python-dateutil`, `attr` → `attrs`,
   `PIL` → `pillow`, `cv2` → `opencv-python`, `sklearn` → `scikit-learn`).
3. If installation fails, a status line says so and execution proceeds, so the
   user sees the genuine `ModuleNotFoundError` traceback.

If the code has a syntax error, import resolution is skipped and the
`SyntaxError` is reported by the normal run path.

### Stop

Stop terminates the worker and immediately creates a new one. This is the only
way to interrupt a tight loop without cross-origin isolation headers, which
static hosts such as GitHub Pages cannot set. Re-initialisation takes roughly
1–2 s from the HTTP cache. The console prints `Stopped.`; the Run button is
disabled until the new worker posts `ready`.

### Output safety

- Python blocks the worker's event loop while it runs, so the worker cannot use
  timers to batch output; every decision happens inside the write callback. The
  worker forwards writes immediately while at most 100 messages have been sent in
  the current 50 ms window, so ordinary programs see each `print` right away even
  when a long computation follows. Beyond that budget, writes are coalesced and
  sent when the window rolls over, when 64 KB has accumulated, or at the final
  flush before `done`. A `while True: print()` loop therefore costs the main
  thread at most ~2,000 messages per second.
- The main thread queues incoming chunks and commits them to React state at most
  every 32 ms.
- The console keeps at most 5,000 lines; older lines are dropped and a
  `… earlier output truncated` marker is shown.
- Package-loader log lines are routed to status messages, never to the program's
  stdout.

### `input()`

Not supported in v1. `input()` raises `RuntimeError("input() is not supported in
this playground")`.

## Pads

```ts
interface Pad {
  id: string;        // crypto.randomUUID()
  title: string;
  code: string;
  createdAt: number; // epoch ms
  updatedAt: number;
}
```

- Stored as one JSON document under `coderpad-sim:pads`; the active pad id under
  `coderpad-sim:active-pad`.
- `padStore.ts` exposes pure functions over a `PadState` value
  (`createPad`, `renamePad`, `updateCode`, `deletePad`, `selectPad`) plus
  `loadState` / `saveState` that take a `Storage`-like object so they are testable.
- Autosave is debounced at 500 ms and also flushes on `beforeunload`.
- There is always at least one pad: deleting the last pad creates a fresh one.
- Delete asks for confirmation.
- New pads are titled `Untitled pad N` and start from a short hello-world
  template.
- Corrupt or missing storage falls back to a single fresh pad.

## Timer

```ts
type TimerState =
  | { status: "idle"; durationMs: number }
  | { status: "running"; durationMs: number; endsAt: number }
  | { status: "paused"; durationMs: number; remainingMs: number };
```

- Pure transition functions: `start`, `pause`, `resume`, `reset`, `setDuration`,
  and `remaining(state, now)`.
- Presets 30 / 45 / 60 minutes plus a custom minutes field (1–180).
- State persists under `coderpad-sim:timer`; because a running timer stores
  `endsAt`, a page refresh does not lose time.
- Display `MM:SS`; amber when ≤ 5 minutes remain; red with "Time's up" at zero
  (it does not count into negative time).

## Code structure

```
src/
  main.tsx, App.tsx, styles.css
  storage.ts               safe localStorage access
  runner/
    protocol.ts            message types shared by worker and hook
    harness.py             import resolution + exec + traceback formatting
    harness.ts             loads harness.py into Pyodide; runProgram orchestration
    pyodide.worker.ts      loads Pyodide, runs programs, forwards output
    outputBuffer.ts        budgeted output forwarding (pure, testable)
    consoleModel.ts        console segments + 5,000-line cap (pure, testable)
    usePythonRunner.ts     worker lifecycle, run/stop, console state
  pads/
    padStore.ts            pure CRUD + storage
    usePads.ts             React binding + debounced autosave
  timer/
    timer.ts               pure state transitions
    useTimer.ts            React binding + ticking
  components/
    TopBar.tsx, PadSidebar.tsx, CodeEditor.tsx,
    OutputConsole.tsx, SplitPane.tsx, Timer.tsx
tests/
  harness.integration.test.ts   real Pyodide in Node
e2e/
  smoke.spec.ts                 Playwright
```

## Error handling

- **Pyodide fails to load** (offline, CDN blocked): console shows the error and a
  "Retry" action that recreates the worker; the editor stays usable.
- **Worker crashes** (`onerror`): treated like Stop, with an error line in the
  console, then a fresh worker.
- **Storage quota / unavailable**: autosave failures show a non-blocking warning
  in the sidebar; the app keeps working in memory.

## Testing

- **Unit (Vitest):** `padStore` (CRUD, last-pad rule, corrupt storage),
  `timer` (all transitions, refresh survival, clamp at zero), `outputBuffer`
  (time and size flush thresholds).
- **Integration (Vitest, Node):** loads the real `pyodide` npm package and runs
  `harness.py`: stdout capture, traceback starts at `main.py` with the correct
  line, `SyntaxError` format, fresh globals between runs, `import numpy` works,
  a pure-Python PyPI package installs via micropip, `input()` raises the
  documented error.
- **E2E (Playwright, Chromium):** app loads; running numpy code prints the
  expected result; an infinite loop can be stopped and the next run succeeds;
  pad code survives a reload.

## Revision: UI v2 (2026-09-17)

After the first build, the interface was reworked to mirror CoderPad's pad layout more
closely and to improve keyboard use. This supersedes the Layout section above where they
differ; execution, pads, and timer behaviour are unchanged.

- **Layout:** left icon rail (pads toggle, theme toggle); pads panel beside it; Run/Stop at
  the top-left of the editor next to the `main.py` tab; right pane with **Program Output**
  and **Notes** tabs; bottom status bar (language, indentation, cursor position, save state,
  runtime status). The top bar holds the brand, pad title, timer, and the palette trigger.
- **Command palette:** Cmd/Ctrl+K, a native modal `<dialog>`. Lists every action with its
  shortcut, searchable by title words, section, keywords, or initials. The command list is
  derived from live state (for example Stop replaces Run while a program is running).
- **Themes:** dark and light, defaulting to the system setting, persisted under
  `coderpad-sim:theme`, applied before first paint by a small script in `index.html`.
- **Notes:** each pad has a free-form `notes` string; pads saved before this load with `""`.
- **State outside React where timing matters:** `PadSession` (pad state) and `CursorStore`
  (cursor position) are external stores read through `useSyncExternalStore`. The editor is
  uncontrolled: Monaco's model owns the text. This fixed dropped keystrokes under load and
  edits lost when reloading inside the autosave window.
