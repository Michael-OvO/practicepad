# Interactive `input()` and lazy Python — design

Two changes to the runner. Programs can read from stdin interactively, the way
they do in CoderPad's console, and the Python runtime is loaded on the first Run
rather than at startup. Everything else in the simulator spec
(`2026-09-17-coderpad-simulator-design.md`, "Execution") holds; this document
replaces its "`input()`" section and amends "Worker protocol", "Stop" and
"Testing".

## Why

- `input()` raised an error in v1. Interview problems that read stdin, and any
  program that asks a question, could not be practised.
- Pyodide was loaded when the page opened. It costs about 165 MB of memory and a
  CDN download whether or not the user ever runs anything.

## Interactive stdin

### Behaviour

- When the program reads from stdin, the run pauses and a text field appears
  inline at the end of the console, straight after whatever the program printed
  last (for `input("Name: ")`, that is the prompt). The field takes focus.
- **Enter** sends the line. It is echoed into the console as an `input`
  segment, styled a shade apart from stdout, and the program continues.
- **Ctrl+D** sends end-of-file for that one read: `input()` raises `EOFError`,
  `sys.stdin.readline()` returns `""`, `sys.stdin.read()` returns what it has
  collected. The next read waits for a new line again, as a terminal does.
- **Stop** works while the program is waiting (the worker is replaced, as for
  any other stop).
- The field is gone as soon as the read completes. Nothing else in the UI
  changes state: no new status-bar text, no new toolbar controls.
- Pasting several lines submits them as one line; splitting a paste into
  successive reads is out of scope.
- Everything that reads stdin works: `input()`, `sys.stdin.readline()`,
  iteration over `sys.stdin`, `sys.stdin.read()`.

### Mechanism

The worker blocks on a `SharedArrayBuffer` with `Atomics.wait` until the main
thread has written a line. `SharedArrayBuffer` exists only on cross-origin
isolated pages, so the page is served with

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

from `vercel.json` in production and from `server.headers` / `preview.headers`
in `vite.config.ts` for `vite`, `vite preview` and the Playwright run. Every
cross-origin resource the app loads already answers with the headers COEP
demands: jsDelivr (Monaco, Pyodide, its packages) and Google Fonts send
`Cross-Origin-Resource-Policy: cross-origin`; PyPI and files.pythonhosted.org
send `Access-Control-Allow-Origin: *`, and micropip fetches them in CORS mode.

Per run, the main thread allocates one 64 KiB `SharedArrayBuffer` and sends it
with the code. Its layout, owned by `src/runner/inputChannel.ts`:

| Offset | Int32 | Meaning |
|---|---|---|
| 0 | `state` | `0` empty, `1` a line is ready, `2` end-of-file |
| 4 | `length` | byte length of the line |
| 8… | | UTF-8 bytes of the line, without its newline |

Main thread: `writeLine(channel, text)` encodes into the bytes region (a line
longer than the region is cut to fit), stores `length`, stores `state = 1`,
`Atomics.notify`. `writeEof(channel)` stores `state = 2` and notifies.

Worker: `pyodide.setStdin({ stdin })`, where `stdin` flushes the output buffer
(so the prompt reaches the console first), posts `{ type: "input", runId }`,
`Atomics.wait`s until `state !== 0`, reads the line or the EOF, resets `state`
to `0`, and returns the string, or `null` for EOF. Pyodide appends the newline
and hands one line per call to Python; `null` ends that one read.

When the page is not cross-origin isolated (a host that cannot set headers), the
`run` message carries `input: null`, the worker does not call `setStdin`, and
`harness.py` keeps installing a `builtins.input` that raises
`RuntimeError("input() is not available: this page is not cross-origin isolated")`.

### Protocol

Main → worker:

- `{ type: "run", runId, code, input: SharedArrayBuffer | null }`

Worker → main:

- `{ type: "input", runId }` — the program is waiting for a line.

Everything else is unchanged. As before, messages for a `runId` other than the
current one are ignored.

### Code structure

- `src/runner/inputChannel.ts` — `createInputChannel()`, `writeLine`,
  `writeEof`, `readLine` (the blocking side). Pure functions over the buffer,
  no worker or DOM, so they are unit-tested in Node.
- `RunnerController` — `provideInput(line)`, `endInput()`, and a new event
  `awaitingInput(waiting: boolean)`. It creates the channel for each run and
  ignores input requests from stale runs.
- `usePythonRunner` — exposes `awaitingInput`, `provideInput`, `endInput`.
- `consoleModel` — `ConsoleKind` gains `"input"` for the echo.
- `OutputPanel` — renders the inline field when `awaitingInput` is true.
- `harness.py` — `run_main` no longer replaces `builtins.input` when stdin is
  wired; the blocked version stays for the non-isolated case.

## Lazy Python

- `RunnerStatus` gains `"idle"`: no worker exists, Run is enabled and the status
  bar reads "Python loads on first run".
- The first Run spawns the worker, prints the system line
  `Loading Python… (first run only)`, shows status `loading` (Run disabled with
  its existing "Python is still loading" title) and runs the queued code as soon
  as the worker is ready. A second Run pressed while loading replaces the queued
  code. Later runs are immediate, as today.
- Stop, crash, `fatal` and Retry behave as before. After Stop, the replacement
  worker still starts immediately, so re-running after a stop stays quick.
- The `pyodide` import in the worker is unchanged; only when the worker is
  created moves.

## Testing

- **Unit (Vitest):** `inputChannel` round trip, EOF, empty line, a line longer
  than the buffer; `RunnerController`: idle at start, first run spawns and
  queues, second run while loading replaces the queue, `input` message raises
  `awaitingInput`, `provideInput`/`endInput` write to the channel and clear it,
  an `input` message from a stale run is ignored, Stop while waiting;
  `consoleModel` accepts the `input` kind.
- **Integration (Vitest, Node):** with a scripted `stdin`, `input()` returns
  the lines, `EOFError` on `null`, `sys.stdin.read()` collects until EOF and a
  later `input()` reads again; without stdin, `input()` raises the documented
  error.
- **E2E (Playwright, Chromium):** `crossOriginIsolated` is `true`; a program
  calling `input()` twice pauses, accepts typed lines, echoes them and prints
  the result; Ctrl+D produces an `EOFError` traceback; Stop while waiting prints
  `Stopped.` and the next run works; the first Run on a fresh page loads Python
  and then prints.
- README: the "`input()` is not supported" line is replaced by a description of
  the console field and Ctrl+D.
