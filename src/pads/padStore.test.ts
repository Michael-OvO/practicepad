import { describe, expect, it } from "vitest";
import {
  ACTIVE_PAD_KEY,
  PADS_KEY,
  STARTER_CODE,
  activePad,
  addTest,
  createPad,
  deletePad,
  initialState,
  loadState,
  removeTest,
  renamePad,
  saveState,
  selectPad,
  sortedByRecent,
  updateCode,
  updateNotes,
  updateTest,
} from "./padStore";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe("initialState", () => {
  it("starts with one active pad holding the starter code", () => {
    expect(initialState(1000, "a")).toEqual({
      pads: [{ id: "a", title: "Untitled pad 1", code: STARTER_CODE, notes: "", tests: [], createdAt: 1000, updatedAt: 1000 }],
      activeId: "a",
    });
  });
});

describe("createPad", () => {
  it("appends a new pad and makes it active", () => {
    const state = createPad(initialState(1, "a"), 2, "b");
    expect(state.pads.map((pad) => pad.id)).toEqual(["a", "b"]);
    expect(state.activeId).toBe("b");
    expect(activePad(state).title).toBe("Untitled pad 2");
  });

  it("numbers untitled pads after the highest existing number", () => {
    let state = createPad(initialState(1, "a"), 2, "b");
    state = deletePad(state, "a", 3);
    state = createPad(state, 4, "c");
    expect(activePad(state).title).toBe("Untitled pad 3");
  });
});

describe("selectPad", () => {
  it("activates an existing pad", () => {
    const state = createPad(initialState(1, "a"), 2, "b");
    expect(selectPad(state, "a").activeId).toBe("a");
  });

  it("ignores unknown ids", () => {
    const state = initialState(1, "a");
    expect(selectPad(state, "missing")).toBe(state);
  });
});

describe("renamePad", () => {
  it("trims the title and bumps updatedAt", () => {
    const state = renamePad(initialState(1, "a"), "a", "  Two Sum  ", 50);
    expect(activePad(state)).toMatchObject({ title: "Two Sum", updatedAt: 50, createdAt: 1 });
  });

  it("ignores blank titles", () => {
    const state = initialState(1, "a");
    expect(renamePad(state, "a", "   ", 50)).toBe(state);
  });
});

describe("updateCode", () => {
  it("changes only the targeted pad", () => {
    let state = createPad(initialState(1, "a"), 2, "b");
    state = updateCode(state, "a", "print(1)", 99);
    expect(state.pads.find((pad) => pad.id === "a")).toMatchObject({ code: "print(1)", updatedAt: 99 });
    expect(state.pads.find((pad) => pad.id === "b")).toMatchObject({ code: STARTER_CODE, updatedAt: 2 });
  });
});

describe("updateNotes", () => {
  it("stores notes on the targeted pad without touching its code", () => {
    const state = updateNotes(initialState(1, "a"), "a", "edge case: empty list", 40);
    expect(activePad(state)).toMatchObject({ notes: "edge case: empty list", code: STARTER_CODE, updatedAt: 40 });
  });
});

describe("test cases", () => {
  it("adds an empty case and bumps updatedAt", () => {
    const state = addTest(initialState(1, "a"), "a", 40, "t1");
    expect(activePad(state)).toMatchObject({ tests: [{ id: "t1", input: "", expected: "" }], updatedAt: 40 });
  });

  it("patches one field of one case", () => {
    let state = addTest(initialState(1, "a"), "a", 2, "t1");
    state = addTest(state, "a", 3, "t2");
    state = updateTest(state, "a", "t2", { input: "3\n" }, 50);
    expect(activePad(state).tests).toEqual([
      { id: "t1", input: "", expected: "" },
      { id: "t2", input: "3\n", expected: "" },
    ]);
    expect(activePad(state).updatedAt).toBe(50);
  });

  it("removes a case", () => {
    let state = addTest(initialState(1, "a"), "a", 2, "t1");
    state = removeTest(state, "a", "t1", 60);
    expect(activePad(state)).toMatchObject({ tests: [], updatedAt: 60 });
  });

  it("ignores unknown pads and cases", () => {
    const state = addTest(initialState(1, "a"), "a", 2, "t1");
    expect(updateTest(state, "a", "nope", { input: "x" })).toBe(state);
    expect(removeTest(state, "a", "nope")).toBe(state);
    expect(addTest(state, "nope")).toBe(state);
  });
});

describe("deletePad", () => {
  it("activates the most recently updated pad when the active one is deleted", () => {
    let state = createPad(initialState(1, "a"), 2, "b");
    state = createPad(state, 3, "c");
    state = updateCode(state, "a", "x = 1", 10);
    state = deletePad(state, "c", 11);
    expect(state.pads.map((pad) => pad.id)).toEqual(["a", "b"]);
    expect(state.activeId).toBe("a");
  });

  it("keeps the active pad when another pad is deleted", () => {
    const state = deletePad(createPad(initialState(1, "a"), 2, "b"), "a", 3);
    expect(state.activeId).toBe("b");
  });

  it("creates a fresh pad when the last one is deleted", () => {
    const state = deletePad(initialState(1, "a"), "a", 7, "fresh");
    expect(state).toEqual(initialState(7, "fresh"));
  });

  it("ignores unknown ids", () => {
    const state = initialState(1, "a");
    expect(deletePad(state, "missing", 2)).toBe(state);
  });
});

describe("sortedByRecent", () => {
  it("orders pads by updatedAt, newest first, without mutating the input", () => {
    const state = updateCode(createPad(initialState(1, "a"), 2, "b"), "a", "x", 5);
    expect(sortedByRecent(state.pads).map((pad) => pad.id)).toEqual(["a", "b"]);
    expect(state.pads.map((pad) => pad.id)).toEqual(["a", "b"]);
  });
});

describe("persistence", () => {
  it("round-trips through storage", () => {
    const storage = fakeStorage();
    const state = selectPad(createPad(initialState(1, "a"), 2, "b"), "a");
    expect(saveState(storage, state)).toBe(true);
    expect(loadState(storage, 100, "unused")).toEqual(state);
  });

  it("falls back to a fresh pad when storage is empty, corrupt, or not an array", () => {
    expect(loadState(fakeStorage(), 5, "n")).toEqual(initialState(5, "n"));
    expect(loadState(fakeStorage({ [PADS_KEY]: "{not json" }), 5, "n")).toEqual(initialState(5, "n"));
    expect(loadState(fakeStorage({ [PADS_KEY]: '{"pads":1}' }), 5, "n")).toEqual(initialState(5, "n"));
  });

  it("drops malformed pads and repairs a stale active id", () => {
    const good = { id: "g", title: "Good", code: "pass", notes: "n", tests: [], createdAt: 1, updatedAt: 2 };
    const storage = fakeStorage({
      [PADS_KEY]: JSON.stringify([good, { id: 7, title: "bad" }, null]),
      [ACTIVE_PAD_KEY]: "gone",
    });
    expect(loadState(storage, 5, "n")).toEqual({ pads: [good], activeId: "g" });
  });

  it("loads pads saved before notes existed, with empty notes", () => {
    const legacy = { id: "old", title: "Old", code: "pass", createdAt: 1, updatedAt: 2 };
    const state = loadState(fakeStorage({ [PADS_KEY]: JSON.stringify([legacy]) }), 5, "n");
    expect(state.pads).toEqual([{ ...legacy, notes: "", tests: [] }]);
  });

  it("loads pads saved before test cases existed, and drops malformed cases", () => {
    const legacy = { id: "old", title: "Old", code: "pass", notes: "", createdAt: 1, updatedAt: 2 };
    const messy = { ...legacy, id: "messy", tests: [{ id: "ok", input: "1", expected: "2" }, { id: 3 }, "junk"] };
    const state = loadState(fakeStorage({ [PADS_KEY]: JSON.stringify([legacy, messy]) }), 5, "n");
    expect(state.pads[0].tests).toEqual([]);
    expect(state.pads[1].tests).toEqual([{ id: "ok", input: "1", expected: "2" }]);
  });

  it("reports failure when storage is unavailable or full", () => {
    const state = initialState(1, "a");
    expect(saveState(null, state)).toBe(false);
    const full = {
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(saveState(full, state)).toBe(false);
    expect(loadState(null, 5, "n")).toEqual(initialState(5, "n"));
  });
});
