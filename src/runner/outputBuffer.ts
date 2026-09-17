import type { OutputChunk, OutputStream } from "./protocol";

export interface OutputBufferOptions {
  now?: () => number;
  windowMs?: number;
  immediatePerWindow?: number;
  maxBufferedChars?: number;
}

/**
 * Forwards program output from the worker without flooding the main thread.
 *
 * Python blocks the worker's event loop while it runs, so timers cannot be used to batch:
 * every decision happens inside write(). Writes go out immediately while the current time
 * window still has budget, which keeps ordinary programs live even when a long computation
 * follows a print. Past the budget, writes are coalesced until the window rolls over, the
 * buffer grows large, or flush() is called at the end of the run.
 */
export class OutputBuffer {
  private readonly emit: (chunks: OutputChunk[]) => void;
  private readonly now: () => number;
  private readonly windowMs: number;
  private readonly immediatePerWindow: number;
  private readonly maxBufferedChars: number;
  private pending: OutputChunk[] = [];
  private pendingChars = 0;
  private windowStart = Number.NEGATIVE_INFINITY;
  private sentInWindow = 0;

  constructor(emit: (chunks: OutputChunk[]) => void, options: OutputBufferOptions = {}) {
    this.emit = emit;
    this.now = options.now ?? (() => performance.now());
    this.windowMs = options.windowMs ?? 50;
    this.immediatePerWindow = options.immediatePerWindow ?? 100;
    this.maxBufferedChars = options.maxBufferedChars ?? 64 * 1024;
  }

  write(stream: OutputStream, text: string): void {
    if (text === "") return;
    const now = this.now();
    if (now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.sentInWindow = 0;
    }
    const last = this.pending[this.pending.length - 1];
    if (last && last.stream === stream) last.text += text;
    else this.pending.push({ stream, text });
    this.pendingChars += text.length;
    if (this.sentInWindow < this.immediatePerWindow || this.pendingChars >= this.maxBufferedChars) {
      this.flush();
    }
  }

  flush(): void {
    if (this.pending.length === 0) return;
    const chunks = this.pending;
    this.pending = [];
    this.pendingChars = 0;
    this.sentInWindow += 1;
    this.emit(chunks);
  }
}
