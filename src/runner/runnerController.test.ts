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
  });
  controller.start();

  return {
    controller,
    workers,
    statuses,
    texts,
    clears: () => clears,
    lastStatus: () => statuses[statuses.length - 1],
  };
}

describe("RunnerController", () => {
  it("loads, then becomes ready", () => {
    const t = setup();
    expect(t.lastStatus()).toBe("loading");
    t.workers[0].send({ type: "ready" });
    expect(t.lastStatus()).toBe("ready");
  });

  it("ignores run requests until the runtime is ready", () => {
    const t = setup();
    t.controller.run("print(1)");
    expect(t.workers[0].posted).toEqual([]);
  });

  it("clears the console and posts the code when a run starts", () => {
    const t = setup();
    t.workers[0].send({ type: "ready" });
    t.controller.run("print(1)");
    expect(t.clears()).toBe(1);
    expect(t.lastStatus()).toBe("running");
    expect(t.workers[0].posted).toEqual([{ type: "run", runId: 1, code: "print(1)" }]);
  });

  it("forwards status and output, then summarises the run", () => {
    const t = setup();
    t.workers[0].send({ type: "ready" });
    t.controller.run("print(1)");
    t.workers[0].send({ type: "status", runId: 1, message: "Loading numpy…" });
    t.workers[0].send({
      type: "output",
      runId: 1,
      chunks: [
        { stream: "stdout", text: "1\n" },
        { stream: "stderr", text: "warn\n" },
      ],
    });
    t.workers[0].send({ type: "done", runId: 1, exitCode: 0, durationMs: 1234 });
    expect(t.texts).toEqual(["system:Loading numpy…\n", "stdout:1\n", "stderr:warn\n", "system:Finished in 1.23s\n"]);
    expect(t.lastStatus()).toBe("ready");
  });

  it("reports a non-zero exit code and starts system lines on a fresh line", () => {
    const t = setup();
    t.workers[0].send({ type: "ready" });
    t.controller.run("x");
    t.workers[0].send({ type: "output", runId: 1, chunks: [{ stream: "stdout", text: "no newline" }] });
    t.workers[0].send({ type: "done", runId: 1, exitCode: 1, durationMs: 50 });
    expect(t.texts[t.texts.length - 1]).toBe("system:\nExited with code 1 after 0.05s\n");
  });

  it("ignores messages that belong to an earlier run", () => {
    const t = setup();
    t.workers[0].send({ type: "ready" });
    t.controller.run("first");
    t.workers[0].send({ type: "done", runId: 1, exitCode: 0, durationMs: 1 });
    t.controller.run("second");
    const before = t.texts.length;
    t.workers[0].send({ type: "output", runId: 1, chunks: [{ stream: "stdout", text: "stale" }] });
    expect(t.texts).toHaveLength(before);
  });

  it("stops by replacing the worker, and ignores the old one afterwards", () => {
    const t = setup();
    t.workers[0].send({ type: "ready" });
    t.controller.run("while True: pass");
    t.controller.stop();
    expect(t.workers[0].terminated).toBe(true);
    expect(t.workers).toHaveLength(2);
    expect(t.texts).toContain("system:Stopped.\n");
    expect(t.lastStatus()).toBe("loading");

    t.workers[0].send({ type: "output", runId: 1, chunks: [{ stream: "stdout", text: "ghost" }] });
    expect(t.texts).not.toContain("stdout:ghost");

    t.workers[1].send({ type: "ready" });
    t.controller.run("print(2)");
    expect(t.workers[1].posted).toEqual([{ type: "run", runId: 2, code: "print(2)" }]);
  });

  it("does nothing when stop is pressed while idle", () => {
    const t = setup();
    t.workers[0].send({ type: "ready" });
    t.controller.stop();
    expect(t.workers).toHaveLength(1);
  });

  it("restarts the worker when the interpreter crashes mid-run", () => {
    const t = setup();
    t.workers[0].send({ type: "ready" });
    t.controller.run("boom");
    t.workers[0].send({ type: "crashed", runId: 1, message: "memory access out of bounds" });
    expect(t.texts.join("")).toContain("The Python runtime crashed: memory access out of bounds");
    expect(t.workers).toHaveLength(2);
    expect(t.lastStatus()).toBe("loading");
  });

  it("enters the error state when the runtime cannot load, and can retry", () => {
    const t = setup();
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
    loading.workers[0].fail("script error");
    expect(loading.lastStatus()).toBe("error");
    expect(loading.workers).toHaveLength(1);

    const running = setup();
    running.workers[0].send({ type: "ready" });
    running.controller.run("x");
    running.workers[0].fail("out of memory");
    expect(running.workers).toHaveLength(2);
    expect(running.lastStatus()).toBe("loading");
  });

  it("silences a disposed worker", () => {
    const t = setup();
    t.controller.dispose();
    expect(t.workers[0].terminated).toBe(true);
    const before = t.statuses.length;
    t.workers[0].send({ type: "ready" });
    expect(t.statuses).toHaveLength(before);
  });
});
