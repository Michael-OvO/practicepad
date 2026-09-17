import { describe, expect, it } from "vitest";
import { formatUpdated } from "./formatUpdated";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatUpdated", () => {
  const now = Date.UTC(2026, 8, 17, 12, 0, 0);

  it("uses coarse relative labels for recent edits", () => {
    expect(formatUpdated(now - 20_000, now)).toBe("just now");
    expect(formatUpdated(now - 5 * MINUTE, now)).toBe("5 min ago");
    expect(formatUpdated(now - 3 * HOUR, now)).toBe("3 h ago");
    expect(formatUpdated(now - 2 * DAY, now)).toBe("2 d ago");
  });

  it("falls back to a calendar date after a week", () => {
    expect(formatUpdated(now - 30 * DAY, now)).toMatch(/\d/);
    expect(formatUpdated(now - 30 * DAY, now)).not.toContain("ago");
  });
});
