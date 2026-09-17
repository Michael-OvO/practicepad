import { describe, expect, it } from "vitest";
import { OutputBuffer } from "./outputBuffer";
import type { OutputChunk } from "./protocol";

function setup(options: { immediatePerWindow?: number; maxBufferedChars?: number } = {}) {
  const emitted: OutputChunk[][] = [];
  const clock = { now: 0 };
  const buffer = new OutputBuffer((chunks) => emitted.push(chunks), {
    now: () => clock.now,
    windowMs: 50,
    immediatePerWindow: options.immediatePerWindow ?? 2,
    maxBufferedChars: options.maxBufferedChars ?? 1000,
  });
  return { buffer, emitted, clock };
}

describe("OutputBuffer", () => {
  it("forwards writes immediately while under the per-window budget", () => {
    const { buffer, emitted } = setup();
    buffer.write("stdout", "a\n");
    buffer.write("stderr", "b\n");
    expect(emitted).toEqual([[{ stream: "stdout", text: "a\n" }], [{ stream: "stderr", text: "b\n" }]]);
  });

  it("coalesces writes beyond the budget until the window rolls over", () => {
    const { buffer, emitted, clock } = setup();
    buffer.write("stdout", "1");
    buffer.write("stdout", "2");
    buffer.write("stdout", "3");
    buffer.write("stdout", "4");
    buffer.write("stderr", "E");
    expect(emitted).toHaveLength(2);

    clock.now = 60;
    buffer.write("stdout", "5");
    expect(emitted).toHaveLength(3);
    expect(emitted[2]).toEqual([
      { stream: "stdout", text: "34" },
      { stream: "stderr", text: "E" },
      { stream: "stdout", text: "5" },
    ]);
  });

  it("flushes early once the buffered size limit is reached", () => {
    const { buffer, emitted } = setup({ immediatePerWindow: 0, maxBufferedChars: 5 });
    buffer.write("stdout", "abc");
    expect(emitted).toHaveLength(0);
    buffer.write("stdout", "def");
    expect(emitted).toEqual([[{ stream: "stdout", text: "abcdef" }]]);
  });

  it("flush() sends whatever is pending and is a no-op when empty", () => {
    const { buffer, emitted } = setup({ immediatePerWindow: 0 });
    buffer.flush();
    expect(emitted).toHaveLength(0);
    buffer.write("stdout", "tail");
    buffer.flush();
    buffer.flush();
    expect(emitted).toEqual([[{ stream: "stdout", text: "tail" }]]);
  });

  it("ignores empty writes", () => {
    const { buffer, emitted } = setup();
    buffer.write("stdout", "");
    buffer.flush();
    expect(emitted).toHaveLength(0);
  });
});
