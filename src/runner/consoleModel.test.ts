import { describe, expect, it } from "vitest";
import { appendText, emptyConsole, type ConsoleState } from "./consoleModel";

const text = (state: ConsoleState) => state.segments.map((segment) => segment.text).join("");

describe("appendText", () => {
  it("merges consecutive text of the same kind into one segment", () => {
    const state = appendText(appendText(emptyConsole, "stdout", "a\n"), "stdout", "b\n");
    expect(state.segments).toEqual([{ id: 1, kind: "stdout", text: "a\nb\n" }]);
    expect(state.lineCount).toBe(2);
  });

  it("starts a new segment when the kind changes", () => {
    let state = appendText(emptyConsole, "stdout", "out\n");
    state = appendText(state, "stderr", "err\n");
    state = appendText(state, "stdout", "out again\n");
    expect(state.segments.map((segment) => [segment.id, segment.kind])).toEqual([
      [1, "stdout"],
      [2, "stderr"],
      [3, "stdout"],
    ]);
  });

  it("keeps echoed input apart from program output", () => {
    const state = appendText(appendText(emptyConsole, "stdout", "name? "), "input", "Ada\n");
    expect(state.segments.map((segment) => segment.kind)).toEqual(["stdout", "input"]);
  });

  it("starts a new segment once the last one is large, so updates stay cheap", () => {
    let state = appendText(emptyConsole, "stdout", "x".repeat(5000));
    state = appendText(state, "stdout", "y");
    expect(state.segments).toHaveLength(2);
  });

  it("returns the same state for empty text", () => {
    expect(appendText(emptyConsole, "stdout", "")).toBe(emptyConsole);
  });

  it("drops the oldest lines beyond the cap and flags truncation", () => {
    let state = emptyConsole;
    for (const line of ["1\n", "2\n", "3\n"]) state = appendText(state, "stdout", line, 3);
    expect(state.truncated).toBe(false);
    state = appendText(state, "stderr", "4\n5\n", 3);
    expect(text(state)).toBe("3\n4\n5\n");
    expect(state.lineCount).toBe(3);
    expect(state.truncated).toBe(true);
  });

  it("trims inside a single oversized write", () => {
    const state = appendText(emptyConsole, "stdout", "1\n2\n3\n4\n5\ntail", 2);
    expect(text(state)).toBe("4\n5\ntail");
    expect(state.lineCount).toBe(2);
    expect(state.truncated).toBe(true);
  });

  it("drops whole leading segments before trimming inside the next one", () => {
    let state = appendText(emptyConsole, "system", "note\n", 3);
    state = appendText(state, "stdout", "1\n2\n3\n4\n", 3);
    expect(state.segments).toEqual([{ id: 2, kind: "stdout", text: "2\n3\n4\n" }]);
  });
});
