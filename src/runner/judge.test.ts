import { describe, expect, it } from "vitest";
import { judge, normalizeOutput, summarizeVerdicts } from "./judge";

const result = (stdout: string, exitCode = 0) => ({ stdout, exitCode });

describe("normalizeOutput", () => {
  it("ignores trailing whitespace on lines and trailing blank lines, nothing else", () => {
    expect(normalizeOutput("a  \nb\t\n\n\n")).toBe("a\nb");
    expect(normalizeOutput("  a\n b")).toBe("  a\n b");
    expect(normalizeOutput("a\r\n")).toBe("a");
  });
});

describe("judge", () => {
  it("passes on a match after normalisation", () => {
    expect(judge(result("42\n"), "42")).toBe("passed");
  });

  it("fails on different text, including case and internal spacing", () => {
    expect(judge(result("42"), "43")).toBe("failed");
    expect(judge(result("a b"), "a  b")).toBe("failed");
    expect(judge(result("Yes"), "yes")).toBe("failed");
  });

  it("reports an error regardless of output when the exit code is not zero", () => {
    expect(judge(result("42", 1), "42")).toBe("error");
  });

  it("only ran when there is no expectation", () => {
    expect(judge(result("anything"), "  \n")).toBe("ran");
  });
});

describe("summarizeVerdicts", () => {
  it("counts judged cases, and mentions the ones that only ran", () => {
    expect(summarizeVerdicts(["passed", "failed", "passed"])).toBe("2 of 3 passed");
    expect(summarizeVerdicts(["passed", "error", "ran"])).toBe("1 of 2 passed, 1 ran");
    expect(summarizeVerdicts(["ran"])).toBe("1 ran");
    expect(summarizeVerdicts([])).toBe("");
  });
});
