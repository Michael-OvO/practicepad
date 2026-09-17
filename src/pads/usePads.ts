import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getStorage } from "../storage";
import { PadSession } from "./padSession";
import {
  activePad,
  createPad,
  deletePad,
  renamePad,
  selectPad,
  updateCode as updatePadCode,
  updateNotes as updatePadNotes,
} from "./padStore";

const AUTOSAVE_DELAY_MS = 500;

export function usePads() {
  const [session] = useState(() => new PadSession(getStorage()));
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSaveFailed(!session.save()), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [session, state]);

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
    (id: string, code: string) => session.apply((current) => updatePadCode(current, id, code)),
    [session],
  );
  const updateNotes = useCallback(
    (id: string, notes: string) => session.apply((current) => updatePadNotes(current, id, notes)),
    [session],
  );
  const remove = useCallback((id: string) => session.apply((current) => deletePad(current, id)), [session]);
  /** The active pad's code as of the last keystroke, even if React has not re-rendered yet. */
  const getActiveCode = useCallback(() => activePad(session.getState()).code, [session]);

  return {
    pads: state.pads,
    active: activePad(state),
    saveFailed,
    create,
    select,
    rename,
    updateCode,
    updateNotes,
    remove,
    getActiveCode,
  };
}
