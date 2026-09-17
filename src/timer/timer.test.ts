import { describe, expect, it } from "vitest";
import {
  clampMinutes,
  formatRemaining,
  idleTimer,
  parseTimer,
  pause,
  remainingMs,
  reset,
  resume,
  setDuration,
  start,
  timerPhase,
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
