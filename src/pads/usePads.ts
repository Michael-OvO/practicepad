import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getStorage } from "../storage";
import { PadSession } from "./padSession";
import {
  activePad,
  addTest as addPadTest,
  createPad,
  deletePad,
  removeTest as removePadTest,
  renamePad,
  selectPad,
  updateCode as updatePadCode,
  updateNotes as updatePadNotes,
  updateTest as updatePadTest,
  type TestCase,
} from "./padStore";

const AUTOSAVE_DELAY_MS = 500;

export function usePads() {
  const [session] = useState(() => new PadSession(getStorage()));
  // Keystrokes are not published (see PadSession), so `state` is not re-rendered for each one.
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [saveFailed, setSaveFailed] = useState(false);

  // Debounced from the session's own change events: those include the keystrokes React never sees.
  useEffect(() => {
    let timer: number | null = null;
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        setSaveFailed(!session.save());
      }, AUTOSAVE_DELAY_MS);
    };
    // Persists a freshly created first pad before anything is typed into it.
    schedule();
    const unsubscribe = session.onChange(schedule);
    return () => {
      unsubscribe();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [session]);

  // Closing or reloading the tab inside the debounce window must not lose the last edit.
  // The session is read directly because React may not have rendered the latest keystrokes yet.
  useEffect(() => {
    const flush = () => {
      session.save();
    };
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, [session]);

  const create = useCallback(() => session.apply((current) => createPad(current)), [session]);
  const select = useCallback((id: string) => session.apply((current) => selectPad(current, id)), [session]);
  const rename = useCallback(
    (id: string, title: string) => session.apply((current) => renamePad(current, id, title)),
    [session],
  );
  const updateCode = useCallback(
    (id: string, code: string) => session.edit(id, (current) => updatePadCode(current, id, code)),
    [session],
  );
  const updateNotes = useCallback(
    (id: string, notes: string) => session.edit(id, (current) => updatePadNotes(current, id, notes)),
    [session],
  );
  const remove = useCallback((id: string) => session.apply((current) => deletePad(current, id)), [session]);
  const addTest = useCallback(
    (padId: string, id: string) => session.apply((current) => addPadTest(current, padId, Date.now(), id)),
    [session],
  );
  // Typing into a case is a text edit like typing code: it need not re-render the app.
  const updateTest = useCallback(
    (padId: string, testId: string, patch: Partial<Pick<TestCase, "input" | "expected">>) =>
      session.edit(padId, (current) => updatePadTest(current, padId, testId, patch)),
    [session],
  );
  const removeTest = useCallback(
    (padId: string, testId: string) => session.apply((current) => removePadTest(current, padId, testId)),
    [session],
  );
  /** The active pad as of the last keystroke; the rendered `active` lags behind it while typing. */
  const getActive = useCallback(() => activePad(session.getState()), [session]);

  return {
    pads: state.pads,
    /** What React shows about the active pad. Its code, notes and test text lag while typing: see getActive(). */
    active: activePad(state),
    saveFailed,
    create,
    select,
    rename,
    updateCode,
    updateNotes,
    remove,
    addTest,
    updateTest,
    removeTest,
    getActive,
  };
}
