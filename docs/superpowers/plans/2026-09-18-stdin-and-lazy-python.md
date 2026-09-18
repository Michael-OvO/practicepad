# Interactive `input()` and Lazy Python Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Programs can read stdin interactively from an inline console field, and Pyodide loads on the first Run instead of at page load.

**Architecture:** The Pyodide worker blocks on a `SharedArrayBuffer` (`Atomics.wait`) until the main thread writes a line; the page is served with COOP/COEP so `SharedArrayBuffer` exists. `RunnerController` owns the per-run channel and a new `awaitingInput` event; `OutputPanel` renders the field. The controller no longer spawns a worker on construction: the first `run()` spawns one and queues the code.

**Tech Stack:** React 19, Vite 8, Pyodide 314.0.7 (CDN in the browser, npm package in Node tests), Vitest 5, Playwright 1.63.

Spec: `docs/superpowers/specs/2026-09-18-stdin-and-lazy-python-design.md`.

## Global Constraints

- Headers on every page response: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`.
- Input channel: one `SharedArrayBuffer` of 64 KiB per run; `Int32` header `state` (0 empty, 1 line, 2 EOF) at byte 0, `length` at byte 4, UTF-8 bytes from byte 8.
- Non-isolated fallback message: `RuntimeError("input() is not available: this page is not cross-origin isolated")`.
- First-run console line: `Loading Python… (first run only)`.
- Status-bar text for the new `idle` status: `Python loads on first run`.
- Run `npx tsc --noEmit` and `npx vitest run` before every commit; they must be clean. `tests/harness.integration.test.ts` downloads nothing (it uses the npm `pyodide`), but takes ~30 s.
- Commit messages: imperative, one line, e.g. `Serve the page cross-origin isolated`.

---

### Task 1: Cross-origin isolation headers

**Files:**
- Create: `vercel.json`
- Modify: `vite.config.ts`
- Test: `e2e/smoke.spec.ts` (append one test)

**Interfaces:**
- Produces: `crossOriginIsolated === true` (and therefore `SharedArrayBuffer`) in `vite`, `vite preview`, Playwright and Vercel.

- [ ] **Step 1: Write the failing e2e test**

Append to `e2e/smoke.spec.ts`:

```ts
// input() blocks the worker on a SharedArrayBuffer, which only exists on isolated pages.
test("the page is cross-origin isolated", async ({ page }) => {
  await page.goto("/");
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test -g "cross-origin isolated"`
Expected: FAIL — `Expected: true, Received: false`.

- [ ] **Step 3: Add the headers**

Create `vercel.json`:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" }
      ]
    }
  ]
}
```

Replace `vite.config.ts` with:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Makes the page cross-origin isolated, which is what gives the Python worker SharedArrayBuffer
// (used to block on input()). vercel.json sends the same headers in production.
const ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  // Relative asset URLs so the build works from any sub-path (GitHub Pages).
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
  server: { headers: ISOLATION_HEADERS },
  preview: { headers: ISOLATION_HEADERS },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
```

- [ ] **Step 4: Run the whole e2e suite**

Run: `npx playwright test`
Expected: all pass, including the new test. The numpy and cowsay (micropip) paths prove that Pyodide, its packages and PyPI still load under COEP; Monaco loading from jsDelivr is covered by every test that types.

- [ ] **Step 5: Commit**

```bash
git add vercel.json vite.config.ts e2e/smoke.spec.ts
git commit -m "Serve the page cross-origin isolated"
```

---

### Task 2: Input channel

**Files:**
- Create: `src/runner/inputChannel.ts`
- Test: `src/runner/inputChannel.test.ts`

**Interfaces:**
- Produces:
  - `createInputChannel(): SharedArrayBuffer | null` — `null` where `SharedArrayBuffer` is undefined (a page that is not cross-origin isolated).
  - `writeLine(channel: SharedArrayBuffer, text: string): void` — main thread; wakes the reader.
  - `writeEof(channel: SharedArrayBuffer): void` — main thread; wakes the reader.
  - `readLine(channel: SharedArrayBuffer): string | null` — blocks (worker only); returns `null` for EOF; leaves the channel empty.

- [ ] **Step 1: Write the failing tests**

Create `src/runner/inputChannel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { INPUT_CHANNEL_BYTES, createInputChannel, readLine, writeEof, writeLine } from "./inputChannel";

// Node always has SharedArrayBuffer and lets the main thread Atomics.wait, so the blocking
// reader can be exercised in-process: a line written first makes the wait return at once.
function channel(): SharedArrayBuffer {
  const created = createInputChannel();
  if (!created) throw new Error("SharedArrayBuffer unavailable");
  return created;
}

describe("inputChannel", () => {
  it("hands a line from the writer to the reader and is empty afterwards", () => {
    const sab = channel();
    writeLine(sab, "Ada Lovelace");
    expect(readLine(sab)).toBe("Ada Lovelace");
    // A second read must not see the old line; check the state word directly.
    expect(new Int32Array(sab)[0]).toBe(0);
  });

  it("delivers an empty line as an empty string, not EOF", () => {
    const sab = channel();
    writeLine(sab, "");
    expect(readLine(sab)).toBe("");
  });

  it("delivers EOF as null", () => {
    const sab = channel();
    writeEof(sab);
    expect(readLine(sab)).toBeNull();
    expect(new Int32Array(sab)[0]).toBe(0);
  });

  it("keeps multi-byte text intact", () => {
    const sab = channel();
    writeLine(sab, "héllo → 世界");
    expect(readLine(sab)).toBe("héllo → 世界");
  });

  it("cuts a line longer than the buffer to what fits", () => {
    const sab = channel();
    writeLine(sab, "x".repeat(INPUT_CHANNEL_BYTES * 2));
    expect(readLine(sab)).toBe("x".repeat(INPUT_CHANNEL_BYTES - 8));
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/runner/inputChannel.test.ts`
Expected: FAIL — cannot resolve `./inputChannel`.

- [ ] **Step 3: Implement the channel**

Create `src/runner/inputChannel.ts`:

```ts
/**
 * One line of stdin, handed from the page to the Python worker through shared memory.
 *
 * Python reads stdin synchronously, so the worker has to block until the user has typed a
 * line. It waits on the state word with Atomics.wait; the page fills the buffer and notifies.
 *
 * Layout (all little-endian Int32 in the header):
 *   byte 0  state   0 empty, 1 a line is ready, 2 end-of-file
 *   byte 4  length  UTF-8 byte length of the line
 *   byte 8… the line, without its newline
 */
export const INPUT_CHANNEL_BYTES = 64 * 1024;

const STATE = 0;
const LENGTH = 1;
const HEADER_BYTES = 8;

const EMPTY = 0;
const LINE = 1;
const EOF = 2;

/** Null on a page that is not cross-origin isolated: browsers hide SharedArrayBuffer there. */
export function createInputChannel(): SharedArrayBuffer | null {
  if (typeof SharedArrayBuffer !== "function") return null;
  return new SharedArrayBuffer(INPUT_CHANNEL_BYTES);
}

export function writeLine(channel: SharedArrayBuffer, text: string): void {
  const header = new Int32Array(channel);
  const bytes = new Uint8Array(channel, HEADER_BYTES);
  // encodeInto never writes a partial character, so a cut line is still valid UTF-8.
  const { written } = new TextEncoder().encodeInto(text, bytes);
  Atomics.store(header, LENGTH, written);
  Atomics.store(header, STATE, LINE);
  Atomics.notify(header, STATE);
}

export function writeEof(channel: SharedArrayBuffer): void {
  const header = new Int32Array(channel);
  Atomics.store(header, LENGTH, 0);
  Atomics.store(header, STATE, EOF);
  Atomics.notify(header, STATE);
}

/** Blocks until the page has written a line or EOF. Only for workers: pages cannot wait. */
export function readLine(channel: SharedArrayBuffer): string | null {
  const header = new Int32Array(channel);
  Atomics.wait(header, STATE, EMPTY);
  const state = Atomics.load(header, STATE);
  const length = Atomics.load(header, LENGTH);
  const text = state === LINE ? new TextDecoder().decode(new Uint8Array(channel, HEADER_BYTES, length)) : null;
  Atomics.store(header, STATE, EMPTY);
  return text;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/runner/inputChannel.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/runner/inputChannel.ts src/runner/inputChannel.test.ts
git commit -m "Add the shared-memory stdin channel"
```

---

### Task 3: Protocol, console kind, and the controller (lazy start + input)

**Files:**
- Modify: `src/runner/protocol.ts`
- Modify: `src/runner/consoleModel.ts:1`
- Modify: `src/runner/runnerController.ts`
- Test: `src/runner/runnerController.test.ts` (rewrite), `src/runner/consoleModel.test.ts` (one test)

**Interfaces:**
- Consumes: `createInputChannel`, `writeLine`, `writeEof` from Task 2.
- Produces:
  - `WorkerRequest = { type: "run"; runId: number; code: string; input: SharedArrayBuffer | null }`
  - `WorkerResponse` gains `{ type: "input"; runId: number }`
  - `ConsoleKind = "stdout" | "stderr" | "system" | "input"`
  - `RunnerStatus = "idle" | "loading" | "ready" | "running" | "error"`
  - `RunnerEvents.awaitingInput(waiting: boolean): void`
  - `RunnerController`: constructor unchanged; **no `start()`**; `run(code)`, `stop()`, `retry()`, `dispose()`, `provideInput(line: string)`, `endInput()`.

- [ ] **Step 1: Write the failing tests**

Add to `src/runner/consoleModel.test.ts`, inside `describe("appendText")`:

```ts
  it("keeps echoed input apart from program output", () => {
    const state = appendText(appendText(emptyConsole, "stdout", "name? "), "input", "Ada\n");
    expect(state.segments.map((segment) => segment.kind)).toEqual(["stdout", "input"]);
  });
```

Replace `src/runner/runnerController.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import type { WorkerRequest, WorkerResponse } from "./protocol";
import { RunnerController, type RunnerStatus, type WorkerFactory } from "./runnerController";

interface FakeWorker {
  posted: WorkerRequest[];
  terminated: boolean;
  send(message: WorkerResponse): void;
  fail(reason: string): void;
}

function setup() {
  const workers: FakeWorker[] = [];
  const statuses: RunnerStatus[] = [];
  const texts: string[] = [];
  const waiting: boolean[] = [];
  let clears = 0;

  const factory: WorkerFactory = (onMessage, onError) => {
    const worker: FakeWorker = { posted: [], terminated: false, send: onMessage, fail: onError };
    workers.push(worker);
    return {
      post: (message) => worker.posted.push(message),
      terminate: () => {
        worker.terminated = true;
      },
    };
  };

  const controller = new RunnerController(factory, {
    status: (status) => statuses.push(status),
    text: (kind, text) => texts.push(`${kind}:${text}`),
    clear: () => {
      clears += 1;
    },
    awaitingInput: (value) => waiting.push(value),
  });

  return {
    controller,
    workers,
    statuses,
    texts,
    waiting,
    clears: () => clears,
    lastStatus: () => statuses[statuses.length - 1],
    /** Runs `code` on a fresh controller and reports the worker ready, so the run is under way. */
    running(code = "print(1)") {
      controller.run(code);
      workers[0].send({ type: "ready" });
      return workers[0];
    },
    posted: (worker: FakeWorker) => worker.posted.map(({ type, runId, code }) => ({ type, runId, code })),
  };
}

describe("RunnerController", () => {
  it("has no worker until the first run, which loads Python and then runs", () => {
    const t = setup();
    expect(t.workers).toHaveLength(0);
    expect(t.statuses).toEqual([]);

    t.controller.run("print(1)");
    expect(t.workers).toHaveLength(1);
    expect(t.lastStatus()).toBe("loading");
    expect(t.clears()).toBe(1);
    expect(t.texts).toEqual(["system:Loading Python… (first run only)\n"]);
    expect(t.workers[0].posted).toEqual([]);

    t.workers[0].send({ type: "ready" });
    expect(t.lastStatus()).toBe("running");
    expect(t.posted(t.workers[0])).toEqual([{ type: "run", runId: 1, code: "print(1)" }]);
    // The loading line stays; the queued run does not clear the console again.
    expect(t.clears()).toBe(1);
  });

  it("replaces the queued code when Run is pressed again while loading", () => {
    const t = setup();
    t.controller.run("first");
    t.controller.run("second");
    t.workers[0].send({ type: "ready" });
    expect(t.posted(t.workers[0])).toEqual([{ type: "run", runId: 1, code: "second" }]);
  });

  it("gives each run a channel for stdin", () => {
    const t = setup();
    const worker = t.running();
    expect(worker.posted[0].input).toBeInstanceOf(SharedArrayBuffer);
  });

  it("clears the console and posts the code when a later run starts", () => {
    const t = setup();
    const worker = t.running();
    worker.send({ type: "done", runId: 1, exitCode: 0, durationMs: 1 });
    t.controller.run("print(2)");
    expect(t.clears()).toBe(2);
    expect(t.lastStatus()).toBe("running");
    expect(t.posted(worker)[1]).toEqual({ type: "run", runId: 2, code: "print(2)" });
  });

  it("forwards status and output, then summarises the run", () => {
    const t = setup();
    const worker = t.running();
    t.texts.length = 0;
    worker.send({ type: "status", runId: 1, message: "Loading numpy…" });
    worker.send({
      type: "output",
      runId: 1,
      chunks: [
        { stream: "stdout", text: "1\n" },
        { stream: "stderr", text: "warn\n" },
      ],
    });
    worker.send({ type: "done", runId: 1, exitCode: 0, durationMs: 1234 });
    expect(t.texts).toEqual(["system:Loading numpy…\n", "stdout:1\n", "stderr:warn\n", "system:Finished in 1.23s\n"]);
    expect(t.lastStatus()).toBe("ready");
  });

  it("reports a non-zero exit code and starts system lines on a fresh line", () => {
    const t = setup();
    const worker = t.running();
    worker.send({ type: "output", runId: 1, chunks: [{ stream: "stdout", text: "no newline" }] });
    worker.send({ type: "done", runId: 1, exitCode: 1, durationMs: 50 });
    expect(t.texts[t.texts.length - 1]).toBe("system:\nExited with code 1 after 0.05s\n");
  });

  it("ignores messages that belong to an earlier run", () => {
    const t = setup();
    const worker = t.running("first");
    worker.send({ type: "done", runId: 1, exitCode: 0, durationMs: 1 });
    t.controller.run("second");
    const before = t.texts.length;
    worker.send({ type: "output", runId: 1, chunks: [{ stream: "stdout", text: "stale" }] });
    worker.send({ type: "input", runId: 1 });
    expect(t.texts).toHaveLength(before);
    expect(t.waiting).toEqual([]);
  });

  describe("stdin", () => {
    it("reports when the program is waiting, and delivers the typed line with an echo", () => {
      const t = setup();
      const worker = t.running();
      worker.send({ type: "input", runId: 1 });
      expect(t.waiting).toEqual([true]);

      t.controller.provideInput("Ada");
      expect(t.waiting).toEqual([true, false]);
      expect(t.texts[t.texts.length - 1]).toBe("input:Ada\n");
      const channel = worker.posted[0].input!;
      const header = new Int32Array(channel);
      expect(header[0]).toBe(1);
      expect(new TextDecoder().decode(new Uint8Array(channel, 8, header[1]))).toBe("Ada");
    });

    it("delivers end-of-file without an echo", () => {
      const t = setup();
      const worker = t.running();
      worker.send({ type: "input", runId: 1 });
      const before = t.texts.length;
      t.controller.endInput();
      expect(t.waiting).toEqual([true, false]);
      expect(t.texts).toHaveLength(before);
      expect(new Int32Array(worker.posted[0].input!)[0]).toBe(2);
    });

    it("ignores input when nothing is waiting for it", () => {
      const t = setup();
      const worker = t.running();
      t.controller.provideInput("stray");
      t.controller.endInput();
      expect(t.waiting).toEqual([]);
      expect(new Int32Array(worker.posted[0].input!)[0]).toBe(0);
    });

    it("stops waiting when the run is stopped", () => {
      const t = setup();
      const worker = t.running();
      worker.send({ type: "input", runId: 1 });
      t.controller.stop();
      expect(t.waiting).toEqual([true, false]);
      expect(worker.terminated).toBe(true);
    });

    it("stops waiting when the run ends without an answer", () => {
      const t = setup();
      const worker = t.running();
      worker.send({ type: "input", runId: 1 });
      worker.send({ type: "crashed", runId: 1, message: "boom" });
      expect(t.waiting).toEqual([true, false]);
    });
  });

  it("stops by replacing the worker, and ignores the old one afterwards", () => {
    const t = setup();
    const worker = t.running("while True: pass");
    t.controller.stop();
    expect(worker.terminated).toBe(true);
    expect(t.workers).toHaveLength(2);
    expect(t.texts).toContain("system:Stopped.\n");
    expect(t.lastStatus()).toBe("loading");

    worker.send({ type: "output", runId: 1, chunks: [{ stream: "stdout", text: "ghost" }] });
    expect(t.texts).not.toContain("stdout:ghost");

    t.workers[1].send({ type: "ready" });
    t.controller.run("print(2)");
    expect(t.posted(t.workers[1])).toEqual([{ type: "run", runId: 2, code: "print(2)" }]);
  });

  it("runs code queued while the replacement worker loads, without clearing the console", () => {
    const t = setup();
    t.running("while True: pass");
    t.controller.stop();
    t.controller.run("print(2)");
    const clearsBefore = t.clears();
    t.workers[1].send({ type: "ready" });
    expect(t.posted(t.workers[1])).toEqual([{ type: "run", runId: 2, code: "print(2)" }]);
    expect(t.clears()).toBe(clearsBefore);
    expect(t.lastStatus()).toBe("running");
  });

  it("does nothing when stop is pressed while not running", () => {
    const idle = setup();
    idle.controller.stop();
    expect(idle.workers).toHaveLength(0);

    const ready = setup();
    const worker = ready.running();
    worker.send({ type: "done", runId: 1, exitCode: 0, durationMs: 1 });
    ready.controller.stop();
    expect(ready.workers).toHaveLength(1);
  });

  it("restarts the worker when the interpreter crashes mid-run", () => {
    const t = setup();
    const worker = t.running("boom");
    worker.send({ type: "crashed", runId: 1, message: "memory access out of bounds" });
    expect(t.texts.join("")).toContain("The Python runtime crashed: memory access out of bounds");
    expect(t.workers).toHaveLength(2);
    expect(t.lastStatus()).toBe("loading");
  });

  it("enters the error state when the runtime cannot load, and can retry", () => {
    const t = setup();
    t.controller.run("print(1)");
    t.workers[0].send({ type: "fatal", message: "Failed to fetch" });
    expect(t.lastStatus()).toBe("error");
    expect(t.texts.join("")).toContain("Could not load the Python runtime: Failed to fetch");
    expect(t.workers[0].terminated).toBe(true);

    t.controller.retry();
    expect(t.workers).toHaveLength(2);
    expect(t.lastStatus()).toBe("loading");
  });

  it("treats a worker error while loading as a load failure, but restarts after a later one", () => {
    const loading = setup();
    loading.controller.run("x");
    loading.workers[0].fail("script error");
    expect(loading.lastStatus()).toBe("error");
    expect(loading.workers).toHaveLength(1);

    const running = setup();
    const worker = running.running("x");
    worker.fail("out of memory");
    expect(running.workers).toHaveLength(2);
    expect(running.lastStatus()).toBe("loading");
  });

  it("silences a disposed worker", () => {
    const t = setup();
    t.controller.run("x");
    t.controller.dispose();
    expect(t.workers[0].terminated).toBe(true);
    const before = t.statuses.length;
    t.workers[0].send({ type: "ready" });
    expect(t.statuses).toHaveLength(before);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/runner/runnerController.test.ts src/runner/consoleModel.test.ts`
Expected: FAIL — type errors on `awaitingInput`/`input`, and the first test fails on `expect(t.workers).toHaveLength(0)`.

- [ ] **Step 3: Update the protocol and console kind**

In `src/runner/protocol.ts` replace the request/response types:

```ts
export type WorkerRequest = {
  type: "run";
  runId: number;
  code: string;
  /** Where the page writes stdin lines; null when the page cannot share memory. */
  input: SharedArrayBuffer | null;
};

export type WorkerResponse =
  | { type: "ready" }
  | { type: "status"; runId: number; message: string }
  | { type: "output"; runId: number; chunks: OutputChunk[] }
  | { type: "input"; runId: number }
  | { type: "done"; runId: number; exitCode: number; durationMs: number }
  | { type: "crashed"; runId: number; message: string }
  | { type: "fatal"; message: string };
```

In `src/runner/consoleModel.ts` line 1:

```ts
export type ConsoleKind = "stdout" | "stderr" | "system" | "input";
```

- [ ] **Step 4: Rewrite the controller**

Replace `src/runner/runnerController.ts` with:

```ts
import type { ConsoleKind } from "./consoleModel";
import { createInputChannel, writeEof, writeLine } from "./inputChannel";
import type { WorkerRequest, WorkerResponse } from "./protocol";

export type RunnerStatus = "idle" | "loading" | "ready" | "running" | "error";

export interface WorkerHandle {
  post(message: WorkerRequest): void;
  terminate(): void;
}

export type WorkerFactory = (
  onMessage: (message: WorkerResponse) => void,
  onError: (reason: string) => void,
) => WorkerHandle;

export interface RunnerEvents {
  status(status: RunnerStatus): void;
  text(kind: ConsoleKind, text: string): void;
  clear(): void;
  /** The program is blocked reading stdin (true) or no longer is (false). */
  awaitingInput(waiting: boolean): void;
}

function summarize(exitCode: number, durationMs: number): string {
  const seconds = (durationMs / 1000).toFixed(2);
  return exitCode === 0 ? `Finished in ${seconds}s` : `Exited with code ${exitCode} after ${seconds}s`;
}

/**
 * Owns the Pyodide worker's lifecycle: loading, running, stopping, and recovering.
 *
 * No worker exists until the first run, so an open tab costs nothing until Run is pressed.
 */
export class RunnerController {
  private readonly createWorker: WorkerFactory;
  private readonly events: RunnerEvents;
  private worker: WorkerHandle | null = null;
  // Bumped whenever the worker is replaced, so callbacks from an old worker are ignored.
  private generation = 0;
  private status: RunnerStatus = "idle";
  private runId = 0;
  private atLineStart = true;
  // Code to run as soon as the loading worker is ready.
  private pending: string | null = null;
  private channel: SharedArrayBuffer | null = null;
  private waiting = false;

  constructor(createWorker: WorkerFactory, events: RunnerEvents) {
    this.createWorker = createWorker;
    this.events = events;
  }

  run(code: string): void {
    switch (this.status) {
      case "idle":
        this.pending = code;
        this.events.clear();
        this.spawn();
        this.system("Loading Python… (first run only)");
        return;
      case "loading":
        this.pending = code;
        return;
      case "ready":
        this.events.clear();
        this.begin(code);
        return;
      default:
        return;
    }
  }

  /** Terminating the worker is the only way to interrupt Python stuck in a tight loop. */
  stop(): void {
    if (this.status !== "running") return;
    this.system("Stopped.");
    this.spawn();
  }

  retry(): void {
    if (this.status === "error") this.spawn();
  }

  dispose(): void {
    this.generation += 1;
    this.stopWaiting();
    this.worker?.terminate();
    this.worker = null;
  }

  /** The line the user typed for the program's pending read. */
  provideInput(line: string): void {
    if (!this.waiting || !this.channel) return;
    writeLine(this.channel, line);
    this.stopWaiting();
    // Echo it, as a terminal would.
    this.events.text("input", `${line}\n`);
    this.atLineStart = true;
  }

  /** Ctrl+D: end the program's pending read. */
  endInput(): void {
    if (!this.waiting || !this.channel) return;
    writeEof(this.channel);
    this.stopWaiting();
  }

  private begin(code: string): void {
    if (!this.worker) return;
    this.runId += 1;
    this.atLineStart = true;
    this.channel = createInputChannel();
    this.setStatus("running");
    this.worker.post({ type: "run", runId: this.runId, code, input: this.channel });
  }

  private spawn(): void {
    this.stopWaiting();
    this.worker?.terminate();
    this.generation += 1;
    const generation = this.generation;
    this.setStatus("loading");
    this.worker = this.createWorker(
      (message) => {
        if (generation === this.generation) this.handleMessage(message);
      },
      (reason) => {
        if (generation === this.generation) this.handleError(reason);
      },
    );
  }

  private handleMessage(message: WorkerResponse): void {
    if (message.type === "ready") {
      this.setStatus("ready");
      const pending = this.pending;
      this.pending = null;
      if (pending !== null) this.begin(pending);
      return;
    }
    if (message.type === "fatal") {
      this.giveUp(`Could not load the Python runtime: ${message.message}`);
      return;
    }
    if (this.status !== "running" || message.runId !== this.runId) return;

    switch (message.type) {
      case "status":
        this.system(message.message);
        break;
      case "output":
        for (const chunk of message.chunks) {
          this.events.text(chunk.stream, chunk.text);
          this.atLineStart = chunk.text.endsWith("\n");
        }
        break;
      case "input":
        this.waiting = true;
        this.events.awaitingInput(true);
        break;
      case "done":
        this.stopWaiting();
        this.system(summarize(message.exitCode, message.durationMs));
        this.setStatus("ready");
        break;
      case "crashed":
        this.system(`The Python runtime crashed: ${message.message}`);
        this.system("Restarting…");
        this.spawn();
        break;
    }
  }

  private handleError(reason: string): void {
    if (this.status === "loading") {
      this.giveUp(`Could not start the Python runtime: ${reason}`);
      return;
    }
    this.system(`The Python runtime crashed: ${reason}`);
    this.system("Restarting…");
    this.spawn();
  }

  private giveUp(message: string): void {
    this.pending = null;
    this.system(message);
    this.worker?.terminate();
    this.worker = null;
    this.setStatus("error");
  }

  private stopWaiting(): void {
    if (!this.waiting) return;
    this.waiting = false;
    this.events.awaitingInput(false);
  }

  private system(message: string): void {
    this.events.text("system", `${this.atLineStart ? "" : "\n"}${message}\n`);
    this.atLineStart = true;
  }

  private setStatus(status: RunnerStatus): void {
    this.status = status;
    this.events.status(status);
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/runner/`
Expected: all pass. (`npx tsc --noEmit` will still fail: `usePythonRunner.ts` calls `start()` and lacks `awaitingInput`; Task 5 fixes it. Do not commit `tsc` failures — do Task 4 and Task 5 before committing if you prefer one green commit, or commit now with the hook fixed minimally as below.)

Minimal hook fix to keep `tsc` green for this commit — in `src/runner/usePythonRunner.ts`, delete the line `controller.start();`, change the initial status to `useState<RunnerStatus>("idle")`, and add `awaitingInput: () => {},` to the events object passed to `new RunnerController(...)`. Task 5 replaces that stub.

- [ ] **Step 6: Typecheck, run everything, commit**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean; all unit tests pass (the integration test still passes: `runProgram` is untouched so far).

```bash
git add src/runner/protocol.ts src/runner/consoleModel.ts src/runner/consoleModel.test.ts src/runner/runnerController.ts src/runner/runnerController.test.ts src/runner/usePythonRunner.ts
git commit -m "Load Python on the first run and route stdin through the controller"
```

---

### Task 4: Worker and harness

**Files:**
- Modify: `src/runner/pyodide.worker.ts`
- Modify: `src/runner/harness.py`
- Modify: `src/runner/harness.ts`
- Test: `tests/harness.integration.test.ts`

**Interfaces:**
- Consumes: `readLine` (Task 2); `WorkerRequest.input`, `{ type: "input" }` (Task 3).
- Produces: `runProgram(pyodide, harness, code, report, interactive = false)`; `Harness.runMain(code, interactive: boolean)`; Python `run_main(code, interactive)`.

- [ ] **Step 1: Write the failing integration tests**

In `tests/harness.integration.test.ts`, change the `run` helper and add tests. Replace the `run` function with:

```ts
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
```

Replace the test `rejects input() with a clear message` with these four:

```ts
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/harness.integration.test.ts`
Expected: type error (`runProgram` takes 4 arguments) → FAIL.

- [ ] **Step 3: Harness — Python side**

In `src/runner/harness.py`, after `DEFAULT_RECURSION_LIMIT = sys.getrecursionlimit()` add:

```python
REAL_INPUT = builtins.input
```

Replace `_blocked_input`:

```python
def _blocked_input(prompt=""):
    raise RuntimeError("input() is not available: this page is not cross-origin isolated")
```

Change `run_main`'s signature and the `builtins.input` line:

```python
def run_main(code, interactive):
    """Execute `code` as a fresh __main__ module and return the exit code.

    `interactive` says whether stdin is wired to the page; without it, input() explains itself
    instead of blocking forever or returning EOF.
    """
```

and

```python
    builtins.input = REAL_INPUT if interactive else _blocked_input
```

- [ ] **Step 4: Harness — TypeScript side**

In `src/runner/harness.ts`:

```ts
export interface Harness {
  findMissingImports(code: string): string[];
  installMissing(names: string[], report: (message: string) => void): Promise<void>;
  runMain(code: string, interactive: boolean): number;
}
```

```ts
    runMain: (code, interactive) => runMain(code, interactive) as number,
```

```ts
/** Makes the program's imports available, runs it, and returns its exit code. */
export async function runProgram(
  pyodide: PyodideInterface,
  harness: Harness,
  code: string,
  report: (message: string) => void,
  interactive = false,
): Promise<number> {
```

and the last line `return harness.runMain(code, interactive);`.

- [ ] **Step 5: Worker**

In `src/runner/pyodide.worker.ts`:

Add the import:

```ts
import { readLine } from "./inputChannel";
```

After `let currentRunId = 0;` add:

```ts
// Set for the duration of a run whose page can share memory; null means input() is unavailable.
let currentInput: SharedArrayBuffer | null = null;

/** Called by Pyodide for each stdin read. Blocks this worker until the page answers. */
function readStdin(): string | null {
  if (!currentInput) return null;
  // The prompt input() just printed must reach the console before the field appears.
  output.flush();
  ctx.postMessage({ type: "input", runId: currentRunId });
  return readLine(currentInput);
}
```

In `boot()`, after `pyodide.setStderr(...)`:

```ts
  pyodide.setStdin({ stdin: readStdin });
```

In `ctx.onmessage`, replace the first lines and the `runProgram` call:

```ts
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
```

- [ ] **Step 6: Run the integration tests and everything else**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean; all pass (the four new integration tests included).

- [ ] **Step 7: Commit**

```bash
git add src/runner/pyodide.worker.ts src/runner/harness.py src/runner/harness.ts tests/harness.integration.test.ts
git commit -m "Wire Python's stdin to the shared-memory channel"
```

---

### Task 5: Hook and UI

**Files:**
- Modify: `src/runner/usePythonRunner.ts`
- Modify: `src/components/RightPane.tsx`
- Modify: `src/components/StatusBar.tsx`
- Modify: `src/components/EditorToolbar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Test: `e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: `RunnerController.provideInput/endInput`, `RunnerEvents.awaitingInput`, `RunnerStatus` `"idle"` (Task 3).
- Produces: `usePythonRunner()` returns `{ status, consoleState, awaitingInput, run, stop, retry, clear, provideInput, endInput }`; `RightPane` props gain `awaitingInput: boolean`, `onInput(line: string): void`, `onEndInput(): void`.

- [ ] **Step 1: Write the failing e2e tests**

Append to `e2e/smoke.spec.ts`:

```ts
const programInput = (page: Page) => page.getByLabel("Program input");

test("input() pauses for a line typed into the console, and echoes it", async ({ page }) => {
  await seedPad(page, 'name = input("Name: ")\nage = input("Age: ")\nprint(f"{name} is {age}")\n');
  await page.goto("/");
  await runButton(page).click();

  await expect(output(page)).toContainText("Name:");
  await expect(programInput(page)).toBeFocused();
  await page.keyboard.type("Ada");
  await page.keyboard.press("Enter");
  await expect(output(page)).toContainText("Name: Ada");

  await expect(output(page)).toContainText("Age:");
  await programInput(page).fill("36");
  await page.keyboard.press("Enter");
  await expect(output(page)).toContainText("Ada is 36");
  await expect(output(page)).toContainText("Finished in");
  await expect(programInput(page)).toHaveCount(0);
});

test("Ctrl+D ends input() with EOFError, and Stop works while waiting", async ({ page }) => {
  await seedPad(page, "input()\n");
  await page.goto("/");
  await runButton(page).click();
  await expect(programInput(page)).toBeVisible();
  await page.keyboard.press("Control+d");
  await expect(output(page)).toContainText("EOFError");
  await expect(output(page)).toContainText("Exited with code 1");

  await expect(runButton(page)).toBeEnabled();
  await runButton(page).click();
  await expect(programInput(page)).toBeVisible();
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(output(page)).toContainText("Stopped.");
  await expect(programInput(page)).toHaveCount(0);
  await expect(runButton(page)).toBeEnabled();
});

test("Python loads on the first run, not when the page opens", async ({ page }) => {
  await seedPad(page, 'print("later")\n');
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("Python loads on first run");
  await expect(runButton(page)).toBeEnabled();
  await runButton(page).click();
  await expect(output(page)).toContainText("Loading Python… (first run only)");
  await expect(output(page)).toContainText("later");
  await expect(page.getByRole("status")).toContainText("Python ready");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx playwright test -g "input\(\)|Ctrl\+D|first run"`
Expected: FAIL — no element labelled "Program input"; status bar never says "Python loads on first run".

- [ ] **Step 3: Hook**

Replace `src/runner/usePythonRunner.ts` with:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { appendText, emptyConsole, type ConsoleKind, type ConsoleState } from "./consoleModel";
import { createPyodideWorker } from "./createPyodideWorker";
import { RunnerController, type RunnerStatus } from "./runnerController";

// Console text is committed to React state at most this often, however fast it arrives.
const COMMIT_INTERVAL_MS = 32;

interface PendingText {
  kind: ConsoleKind;
  text: string;
}

export function usePythonRunner() {
  const [status, setStatus] = useState<RunnerStatus>("idle");
  const [consoleState, setConsoleState] = useState<ConsoleState>(emptyConsole);
  const [awaitingInput, setAwaitingInput] = useState(false);
  const controllerRef = useRef<RunnerController | null>(null);
  const pendingRef = useRef<PendingText[]>([]);
  const timerRef = useRef<number | null>(null);

  const discardPending = useCallback(() => {
    pendingRef.current = [];
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clear = useCallback(() => {
    discardPending();
    setConsoleState(emptyConsole);
  }, [discardPending]);

  useEffect(() => {
    const commit = () => {
      timerRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = [];
      setConsoleState((state) => pending.reduce((next, item) => appendText(next, item.kind, item.text), state));
    };

    const controller = new RunnerController(createPyodideWorker, {
      status: setStatus,
      text: (kind, text) => {
        pendingRef.current.push({ kind, text });
        if (timerRef.current === null) timerRef.current = window.setTimeout(commit, COMMIT_INTERVAL_MS);
      },
      clear,
      awaitingInput: (waiting) => {
        // The prompt was queued just before the request; show it before the field.
        if (waiting && timerRef.current !== null) {
          window.clearTimeout(timerRef.current);
          commit();
        }
        setAwaitingInput(waiting);
      },
    });
    controllerRef.current = controller;

    return () => {
      controller.dispose();
      controllerRef.current = null;
      discardPending();
    };
  }, [clear, discardPending]);

  const run = useCallback((code: string) => controllerRef.current?.run(code), []);
  const stop = useCallback(() => controllerRef.current?.stop(), []);
  const retry = useCallback(() => controllerRef.current?.retry(), []);
  const provideInput = useCallback((line: string) => controllerRef.current?.provideInput(line), []);
  const endInput = useCallback(() => controllerRef.current?.endInput(), []);

  return { status, consoleState, awaitingInput, run, stop, retry, clear, provideInput, endInput };
}
```

- [ ] **Step 4: Status bar and toolbar**

In `src/components/StatusBar.tsx`, add the `idle` entry to `STATUS_TEXT`:

```ts
const STATUS_TEXT: Record<RunnerStatus, string> = {
  idle: "Python loads on first run",
  loading: "Loading Python…",
  ready: "Python ready",
  running: "Running…",
  error: "Python unavailable",
};
```

In `src/components/EditorToolbar.tsx`, the Run button:

```tsx
        <button
          type="button"
          className="run-button"
          title={status === "loading" ? "Python is still loading" : `Run (${RUN_SHORTCUT_LABEL})`}
          onClick={onRun}
          disabled={status === "loading" || status === "error"}
        >
```

- [ ] **Step 5: Console field**

In `src/components/RightPane.tsx`:

Props:

```ts
interface RightPaneProps {
  tab: RightTab;
  consoleState: ConsoleState;
  status: RunnerStatus;
  /** The program is blocked on stdin; show the field. */
  awaitingInput: boolean;
  padId: string;
  /** Only used when a pad's notes are first shown; after that the textarea owns the text. */
  initialNotes: string;
  onTabChange(tab: RightTab): void;
  onNotesChange(notes: string): void;
  onClear(): void;
  onRetry(): void;
  onInput(line: string): void;
  onEndInput(): void;
}
```

Replace `OutputPanel` with:

```tsx
function OutputPanel({ consoleState, status, awaitingInput, onRetry, onInput, onEndInput }: RightPaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const isEmpty = consoleState.segments.length === 0 && !awaitingInput;

  // Follow new output unless the user has scrolled up to read something.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (isEmpty) stickToBottom.current = true;
    if (stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [consoleState, isEmpty, awaitingInput]);

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onInput(event.currentTarget.value);
    } else if (event.key === "d" && event.ctrlKey) {
      // End-of-file, as in a terminal.
      event.preventDefault();
      onEndInput();
    }
  };

  return (
    <div
      id="panel-output"
      className="console-scroll"
      role="tabpanel"
      aria-label="Program output"
      tabIndex={0}
      ref={scrollRef}
      onScroll={(event) => {
        const element = event.currentTarget;
        stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < STICK_THRESHOLD_PX;
      }}
    >
      {isEmpty ? (
        <p className="console-hint">
          Press <strong>Run</strong> or <kbd className="keycap">{RUN_SHORTCUT_LABEL}</kbd> to execute your code. Output,
          errors, and package installs show up here.
        </p>
      ) : (
        <pre className="console-text">
          {consoleState.truncated && <span className="console-system">… earlier output truncated{"\n"}</span>}
          {consoleState.segments.map((segment) => (
            <span key={segment.id} className={`console-${segment.kind}`}>
              {segment.text}
            </span>
          ))}
          {awaitingInput && (
            // Inline, right after the prompt the program printed. Mounted per read, so it is
            // empty and focused each time.
            <input
              className="console-input"
              aria-label="Program input"
              autoFocus
              spellCheck={false}
              autoComplete="off"
              onKeyDown={onInputKeyDown}
            />
          )}
        </pre>
      )}
      {status === "error" && (
        <button type="button" className="text-button console-retry" onClick={onRetry}>
          Retry loading Python
        </button>
      )}
    </div>
  );
}
```

Import `KeyboardEvent` is already imported at the top of the file (`import { useLayoutEffect, useRef, type KeyboardEvent } from "react";`) — no change needed.

In `src/App.tsx`, the `RightPane` element:

```tsx
            <RightPane
              tab={rightTab}
              consoleState={runner.consoleState}
              status={status}
              awaitingInput={runner.awaitingInput}
              padId={active.id}
              initialNotes={getActive().notes}
              onTabChange={setRightTab}
              onNotesChange={handleNotes}
              onClear={clear}
              onRetry={runner.retry}
              onInput={runner.provideInput}
              onEndInput={runner.endInput}
            />
```

- [ ] **Step 6: Styles**

In `src/styles.css`, after the `.console-system` rule add:

```css
/* What the user typed for input(): part of the transcript, a shade apart from stdout. */
.console-input-echo,
.console-input {
  color: var(--accent-text);
}

/* Inline where the program is waiting: no box, just a caret after the prompt. */
.console-input {
  display: inline-block;
  min-width: 12ch;
  max-width: 100%;
  field-sizing: content;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  font: inherit;
  vertical-align: baseline;
}
```

and rename the echo class: the echoed segment renders as `console-input` (from `console-${segment.kind}`) and would collide with the field's class, so in `OutputPanel` change the segment span to `className={`console-${segment.kind === "input" ? "input-echo" : segment.kind}`}`.

In the `.runtime` block (around line 992), give the new status a dot colour by extending the ready rule:

```css
.runtime-idle .runtime-dot,
.runtime-ready .runtime-dot {
  background: var(--accent-text);
}
```

- [ ] **Step 7: Typecheck, unit tests, then the e2e suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean.

Run: `npx playwright test`
Expected: all pass. Existing tests keep working: `runButton` is enabled before Python loads, and `toContainText` waits through the first load.

- [ ] **Step 8: Commit**

```bash
git add src/runner/usePythonRunner.ts src/components/RightPane.tsx src/components/StatusBar.tsx src/components/EditorToolbar.tsx src/App.tsx src/styles.css e2e/smoke.spec.ts
git commit -m "Read stdin from an inline console field; load Python on first run"
```

---

### Task 6: README and spec cross-reference

**Files:**
- Modify: `README.md:46`
- Modify: `docs/superpowers/specs/2026-09-17-coderpad-simulator-design.md:128-131`

- [ ] **Step 1: README**

Replace the line `- \`input()\` is not supported; hard-code your test inputs instead.` under "## Limits" with nothing, and add to the feature list (the bullets above "## Limits", next to "Shortcuts"):

```md
- **Interactive stdin.** When your program calls `input()` (or reads `sys.stdin`), a field appears
  in the output where the program is waiting. Enter sends a line; Ctrl+D sends end-of-file.
- **Python loads on the first Run**, not when the page opens, so an idle tab stays light.
```

- [ ] **Step 2: Old spec pointer**

Replace the `### \`input()\`` section body in the v1 spec with:

```md
Interactive since `2026-09-18-stdin-and-lazy-python-design.md`, which also
moved Pyodide loading to the first Run.
```

- [ ] **Step 3: Commit**

```bash
git add README.md docs/superpowers/specs/2026-09-17-coderpad-simulator-design.md
git commit -m "Document interactive input and lazy Python loading"
```
