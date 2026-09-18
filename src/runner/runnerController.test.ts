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
    /** The run messages a worker received, without the stdin channel. */
    posted: (worker: FakeWorker) => worker.posted.map(({ type, runId, code }) => ({ type, runId, code })),
  };
}

const channelState = (channel: SharedArrayBuffer | null) => new Int32Array(channel!)[0];

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
    // The loading line stays: the queued run does not clear the console again.
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
      expect(channelState(worker.posted[0].input)).toBe(2);
    });

    it("ignores input when nothing is waiting for it", () => {
      const t = setup();
      const worker = t.running();
      t.controller.provideInput("stray");
      t.controller.endInput();
      expect(t.waiting).toEqual([]);
      expect(channelState(worker.posted[0].input)).toBe(0);
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
