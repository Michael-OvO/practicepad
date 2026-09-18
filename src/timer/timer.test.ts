import { describe, expect, it } from "vitest";
import {
  clampMinutes,
  formatRemaining,
  idleTimer,
  parseTimer,
  pause,
  remainingFraction,
  remainingMs,
  reset,
  resume,
  setDuration,
  start,
  stepMinutes,
  timerPhase,
  timerTitle,
} from "./timer";

const MINUTE = 60_000;

describe("transitions", () => {
  it("defaults to an idle 45 minute timer", () => {
    expect(idleTimer()).toEqual({ status: "idle", durationMs: 45 * MINUTE });
  });

  it("starts from idle by fixing the end time", () => {
    expect(start(idleTimer(30), 1_000)).toEqual({ status: "running", durationMs: 30 * MINUTE, endsAt: 1_000 + 30 * MINUTE });
  });

  it("pauses with the time that was left and resumes from it", () => {
    const running = start(idleTimer(30), 0);
    const paused = pause(running, 10 * MINUTE);
    expect(paused).toEqual({ status: "paused", durationMs: 30 * MINUTE, remainingMs: 20 * MINUTE });
    expect(resume(paused, 99 * MINUTE)).toEqual({ status: "running", durationMs: 30 * MINUTE, endsAt: 119 * MINUTE });
  });

  it("resets to idle with the same duration", () => {
    expect(reset(start(idleTimer(60), 0))).toEqual(idleTimer(60));
  });

  it("ignores transitions that do not apply to the current status", () => {
    const idle = idleTimer();
    const running = start(idle, 0);
    expect(pause(idle, 5)).toBe(idle);
    expect(resume(idle, 5)).toBe(idle);
    expect(start(running, 5)).toBe(running);
    expect(setDuration(running, 30)).toBe(running);
  });

  it("changes duration only while idle, clamped to 1-180 whole minutes", () => {
    expect(setDuration(idleTimer(), 20)).toEqual(idleTimer(20));
    expect(clampMinutes(0)).toBe(1);
    expect(clampMinutes(500)).toBe(180);
    expect(clampMinutes(12.6)).toBe(13);
    expect(clampMinutes(Number.NaN)).toBe(45);
  });
});

describe("remainingMs", () => {
  it("counts down while running and never goes negative", () => {
    const running = start(idleTimer(1), 0);
    expect(remainingMs(running, 15_000)).toBe(45_000);
    expect(remainingMs(running, 10 * MINUTE)).toBe(0);
  });

  it("is the full duration when idle and frozen when paused", () => {
    expect(remainingMs(idleTimer(30), 123)).toBe(30 * MINUTE);
    expect(remainingMs(pause(start(idleTimer(30), 0), MINUTE), 50 * MINUTE)).toBe(29 * MINUTE);
  });

  it("survives a reload because a running timer stores its end time", () => {
    const restored = parseTimer(JSON.stringify(start(idleTimer(30), 0)));
    expect(remainingMs(restored, 12 * MINUTE)).toBe(18 * MINUTE);
  });
});

describe("timerPhase", () => {
  it("warns in the last five minutes and expires at zero", () => {
    const running = start(idleTimer(30), 0);
    expect(timerPhase(running, 0)).toBe("normal");
    expect(timerPhase(running, 25 * MINUTE)).toBe("warning");
    expect(timerPhase(running, 30 * MINUTE)).toBe("expired");
  });

  it("stays normal while idle, even for short durations", () => {
    expect(timerPhase(idleTimer(3), 0)).toBe("normal");
  });
});

describe("remainingFraction", () => {
  it("is full while idle and drains to zero as a running session passes", () => {
    const running = start(idleTimer(30), 0);
    expect(remainingFraction(idleTimer(30), 999)).toBe(1);
    expect(remainingFraction(running, 0)).toBe(1);
    expect(remainingFraction(running, 7.5 * MINUTE)).toBe(0.75);
    expect(remainingFraction(running, 99 * MINUTE)).toBe(0);
  });

  it("freezes while paused", () => {
    expect(remainingFraction(pause(start(idleTimer(30), 0), 15 * MINUTE), 99 * MINUTE)).toBe(0.5);
  });

  it("stays within 0-1 for stored states that make no sense", () => {
    expect(remainingFraction({ status: "paused", durationMs: MINUTE, remainingMs: 5 * MINUTE }, 0)).toBe(1);
    expect(remainingFraction({ status: "idle", durationMs: 0 }, 0)).toBe(0);
  });
});

describe("stepMinutes", () => {
  it("moves to the neighbouring multiple of five", () => {
    expect(stepMinutes(45, 1)).toBe(50);
    expect(stepMinutes(45, -1)).toBe(40);
    expect(stepMinutes(47, 1)).toBe(50);
    expect(stepMinutes(47, -1)).toBe(45);
  });

  it("stays within 1-180 minutes", () => {
    expect(stepMinutes(1, 1)).toBe(5);
    expect(stepMinutes(3, -1)).toBe(1);
    expect(stepMinutes(1, -1)).toBe(1);
    expect(stepMinutes(178, 1)).toBe(180);
    expect(stepMinutes(180, 1)).toBe(180);
  });
});

describe("timerTitle", () => {
  it("is just the app name while idle", () => {
    expect(timerTitle(idleTimer(), 0, "PracticePad")).toBe("PracticePad");
  });

  it("leads with the time left while running", () => {
    expect(timerTitle(start(idleTimer(45), 0), 12 * MINUTE + 46_000, "PracticePad")).toBe("32:14 · PracticePad");
  });

  it("says when the clock is paused", () => {
    const paused = pause(start(idleTimer(45), 0), 12 * MINUTE + 46_000);
    expect(timerTitle(paused, 99 * MINUTE, "PracticePad")).toBe("32:14 paused · PracticePad");
  });

  it("announces the end instead of showing 00:00", () => {
    expect(timerTitle(start(idleTimer(1), 0), 5 * MINUTE, "PracticePad")).toBe("Time's up · PracticePad");
  });
});

describe("formatRemaining", () => {
  it("renders MM:SS, rounding partial seconds up", () => {
    expect(formatRemaining(45 * MINUTE)).toBe("45:00");
    expect(formatRemaining(45 * MINUTE - 1)).toBe("45:00");
    expect(formatRemaining(61_000)).toBe("01:01");
    expect(formatRemaining(0)).toBe("00:00");
    expect(formatRemaining(180 * MINUTE)).toBe("180:00");
  });
});

describe("parseTimer", () => {
  it("falls back to the default for missing or malformed data", () => {
    expect(parseTimer(null)).toEqual(idleTimer());
    expect(parseTimer("{oops")).toEqual(idleTimer());
    expect(parseTimer('{"status":"running","durationMs":"x"}')).toEqual(idleTimer());
    expect(parseTimer('{"status":"flying","durationMs":1000}')).toEqual(idleTimer());
  });

  it("accepts each valid shape", () => {
    const paused = pause(start(idleTimer(30), 0), MINUTE);
    expect(parseTimer(JSON.stringify(paused))).toEqual(paused);
    expect(parseTimer(JSON.stringify(idleTimer(60)))).toEqual(idleTimer(60));
  });
});
