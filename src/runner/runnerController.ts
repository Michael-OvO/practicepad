import type { ConsoleKind } from "./consoleModel";
import type { WorkerRequest, WorkerResponse } from "./protocol";

export type RunnerStatus = "loading" | "ready" | "running" | "error";

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
}

function summarize(exitCode: number, durationMs: number): string {
  const seconds = (durationMs / 1000).toFixed(2);
  return exitCode === 0 ? `Finished in ${seconds}s` : `Exited with code ${exitCode} after ${seconds}s`;
}

/** Owns the Pyodide worker's lifecycle: loading, running, stopping, and recovering. */
export class RunnerController {
  private readonly createWorker: WorkerFactory;
  private readonly events: RunnerEvents;
  private worker: WorkerHandle | null = null;
  // Bumped whenever the worker is replaced, so callbacks from an old worker are ignored.
  private generation = 0;
  private status: RunnerStatus = "loading";
  private runId = 0;
  private atLineStart = true;

  constructor(createWorker: WorkerFactory, events: RunnerEvents) {
    this.createWorker = createWorker;
    this.events = events;
  }

  start(): void {
    this.spawn();
  }

  run(code: string): void {
    if (this.status !== "ready" || !this.worker) return;
    this.runId += 1;
    this.atLineStart = true;
    this.events.clear();
    this.setStatus("running");
    this.worker.post({ type: "run", runId: this.runId, code });
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
    this.worker?.terminate();
    this.worker = null;
  }

  private spawn(): void {
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
      case "done":
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
    this.system(message);
    this.worker?.terminate();
    this.worker = null;
    this.setStatus("error");
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
