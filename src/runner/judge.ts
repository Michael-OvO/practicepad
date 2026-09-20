import type { CaseResult } from "./protocol";

export type Verdict = "passed" | "failed" | "error" | "ran";

/** Trailing whitespace per line and trailing blank lines do not count; everything else does. */
export function normalizeOutput(text: string): string {
  const lines = text.split("\n").map((line) => line.replace(/[ \t\r\f\v]+$/, ""));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

export function judge(result: Pick<CaseResult, "stdout" | "exitCode">, expected: string): Verdict {
  if (result.exitCode !== 0) return "error";
  if (expected.trim() === "") return "ran";
  return normalizeOutput(result.stdout) === normalizeOutput(expected) ? "passed" : "failed";
}

/** "2 of 3 passed", with cases that had no expectation counted apart: "1 of 2 passed, 1 ran". */
export function summarizeVerdicts(verdicts: Verdict[]): string {
  const ran = verdicts.filter((verdict) => verdict === "ran").length;
  const judged = verdicts.length - ran;
  const passed = verdicts.filter((verdict) => verdict === "passed").length;
  const parts: string[] = [];
  if (judged > 0) parts.push(`${passed} of ${judged} passed`);
  if (ran > 0) parts.push(`${ran} ran`);
  return parts.join(", ");
}
