import { describe, expect, it } from "vitest";
import { INPUT_CHANNEL_BYTES, createInputChannel, readLine, writeEof, writeLine } from "./inputChannel";

// Node always has SharedArrayBuffer and lets the main thread Atomics.wait, so the blocking
// reader can be exercised in-process: a line written first makes the wait return at once.
function channel(): SharedArrayBuffer {
  const created = createInputChannel();
  if (!created) throw new Error("SharedArrayBuffer unavailable");
  return created;
}

const state = (sab: SharedArrayBuffer) => new Int32Array(sab)[0];

describe("inputChannel", () => {
  it("hands a line from the writer to the reader and is empty afterwards", () => {
    const sab = channel();
    writeLine(sab, "Ada Lovelace");
    expect(readLine(sab)).toBe("Ada Lovelace");
    expect(state(sab)).toBe(0);
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
    expect(state(sab)).toBe(0);
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
