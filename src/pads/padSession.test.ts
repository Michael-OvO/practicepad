import { describe, expect, it } from "vitest";
import { PadSession } from "./padSession";
import { PADS_KEY, activePad, updateCode, type Pad } from "./padStore";

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

const savedPads = (storage: ReturnType<typeof fakeStorage>) => JSON.parse(storage.data.get(PADS_KEY) ?? "[]") as Pad[];

describe("PadSession", () => {
  it("exposes each change synchronously, without waiting for a React render", () => {
    const session = new PadSession(fakeStorage());
    const id = activePad(session.getState()).id;
    session.apply((state) => updateCode(state, id, "print(1)"));
    expect(activePad(session.getState()).code).toBe("print(1)");
  });

  it("saves the latest change even when save() runs immediately after it", () => {
    const storage = fakeStorage();
    const session = new PadSession(storage);
    const id = activePad(session.getState()).id;
    session.apply((state) => updateCode(state, id, "typed just before closing the tab"));
    expect(session.save()).toBe(true);
    expect(savedPads(storage)[0].code).toBe("typed just before closing the tab");
  });

  it("notifies subscribers on change and stops after unsubscribe", () => {
    const session = new PadSession(fakeStorage());
    const id = activePad(session.getState()).id;
    let calls = 0;
    const unsubscribe = session.subscribe(() => {
      calls += 1;
    });
    session.apply((state) => updateCode(state, id, "a"));
    unsubscribe();
    session.apply((state) => updateCode(state, id, "b"));
    expect(calls).toBe(1);
  });

  it("does not notify when a transition changes nothing", () => {
    const session = new PadSession(fakeStorage());
    let calls = 0;
    session.subscribe(() => {
      calls += 1;
    });
    session.apply((state) => state);
    expect(calls).toBe(0);
  });

  it("restores saved pads and reports failure when storage is unavailable", () => {
    const storage = fakeStorage();
    const first = new PadSession(storage);
    const id = activePad(first.getState()).id;
    first.apply((state) => updateCode(state, id, "kept"));
    first.save();
    expect(activePad(new PadSession(storage).getState()).code).toBe("kept");
    expect(new PadSession(null).save()).toBe(false);
  });
});
