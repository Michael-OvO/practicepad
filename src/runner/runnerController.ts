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
