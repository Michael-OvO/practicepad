import { describe, expect, it } from "vitest";
import { searchCommands, type Command } from "./commandSearch";

const command = (title: string, section = "General", keywords?: string): Command => ({
  id: title,
  title,
  section,
  keywords,
  run: () => {},
});

const titles = (commands: Command[]) => commands.map((entry) => entry.title);

const all = [
  command("Run code", "Run"),
  command("Stop execution", "Run"),
  command("New pad", "Pads"),
  command("Go to pad: Fast sort", "Pads"),
  command("Timer: Start", "Timer"),
  command("Timer: Set to 30 minutes", "Timer"),
  command("Theme: Dark", "View", "night"),
];

describe("searchCommands", () => {
  it("returns every command in its original order for an empty query", () => {
    expect(searchCommands(all, "   ")).toBe(all);
  });

  it("ranks a title prefix above a word start above a plain substring", () => {
    expect(titles(searchCommands(all, "st"))).toEqual(["Stop execution", "Timer: Start", "Go to pad: Fast sort"]);
  });

  it("requires every word of the query to match", () => {
    expect(titles(searchCommands(all, "timer 30"))).toEqual(["Timer: Set to 30 minutes"]);
  });

  it("matches on section and keywords, below title matches", () => {
    expect(titles(searchCommands(all, "night"))).toEqual(["Theme: Dark"]);
    expect(titles(searchCommands(all, "pads"))).toEqual(["New pad", "Go to pad: Fast sort"]);
  });

  it("matches initials", () => {
    expect(titles(searchCommands(all, "np"))).toEqual(["New pad"]);
  });

  it("is case-insensitive and survives regex characters", () => {
    // "Stop execution" also matches, through its "Run" section, but ranks below the title match.
    expect(titles(searchCommands(all, "RUN"))).toEqual(["Run code", "Stop execution"]);
    expect(searchCommands(all, "c++ (")).toEqual([]);
  });
});
