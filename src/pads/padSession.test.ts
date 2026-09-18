import { describe, expect, it } from "vitest";
import { PadSession } from "./padSession";
import { PADS_KEY, activePad, createPad, renamePad, sortedByRecent, updateCode, type Pad } from "./padStore";

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

  describe("edit", () => {
    const FIVE_MINUTES = 5 * 60_000;

    it("keeps the latest text readable synchronously", () => {
      const session = new PadSession(fakeStorage());
      const id = activePad(session.getState()).id;
      session.edit(id, (state) => updateCode(state, id, "print(1)"));
      expect(activePad(session.getState()).code).toBe("print(1)");
    });

    it("does not publish keystrokes that change nothing in the pad list", () => {
      const session = new PadSession(fakeStorage());
      const id = activePad(session.getState()).id;
      let calls = 0;
      session.subscribe(() => {
        calls += 1;
      });
      const snapshot = session.getSnapshot();
      session.edit(id, (state) => updateCode(state, id, "a"));
      session.edit(id, (state) => updateCode(state, id, "ab"));
      expect(calls).toBe(0);
      expect(session.getSnapshot()).toBe(snapshot);
    });

    it("publishes an edit that moves the pad to the top of the list", () => {
      const session = new PadSession(fakeStorage());
      const older = activePad(session.getState()).id;
      session.apply((state) => renamePad(state, older, "Old", Date.now() - 1000));
      session.apply((state) => createPad(state));
      let calls = 0;
      session.subscribe(() => {
        calls += 1;
      });
      session.edit(older, (state) => updateCode(state, older, "a"));
      expect(calls).toBe(1);
      expect(sortedByRecent(session.getSnapshot().pads)[0].id).toBe(older);
    });

    it("publishes an edit that refreshes the pad's 'edited' label", () => {
      const session = new PadSession(fakeStorage());
      const id = activePad(session.getState()).id;
      session.apply((state) => renamePad(state, id, "Old", Date.now() - FIVE_MINUTES));
      let calls = 0;
      session.subscribe(() => {
        calls += 1;
      });
      session.edit(id, (state) => updateCode(state, id, "a"));
      expect(calls).toBe(1);
      session.edit(id, (state) => updateCode(state, id, "ab"));
      expect(calls).toBe(1);
    });

    it("reports every change to onChange listeners, keystrokes included", () => {
      const session = new PadSession(fakeStorage());
      const id = activePad(session.getState()).id;
      let changes = 0;
      const unsubscribe = session.onChange(() => {
        changes += 1;
      });
      session.edit(id, (state) => updateCode(state, id, "a"));
      session.edit(id, (state) => updateCode(state, id, "ab"));
      session.apply((state) => createPad(state));
      unsubscribe();
      session.apply((state) => createPad(state));
      expect(changes).toBe(3);
    });
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
