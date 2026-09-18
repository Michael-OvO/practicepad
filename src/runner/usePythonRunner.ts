import { useCallback, useEffect, useRef, useState } from "react";
import { appendText, emptyConsole, type ConsoleKind, type ConsoleState } from "./consoleModel";
import { createPyodideWorker } from "./createPyodideWorker";
import { RunnerController, type RunnerStatus } from "./runnerController";

// Console text is committed to React state at most this often, however fast it arrives.
const COMMIT_INTERVAL_MS = 32;

interface PendingText {
  kind: ConsoleKind;
  text: string;
}

export function usePythonRunner() {
  const [status, setStatus] = useState<RunnerStatus>("idle");
  const [consoleState, setConsoleState] = useState<ConsoleState>(emptyConsole);
  const controllerRef = useRef<RunnerController | null>(null);
  const pendingRef = useRef<PendingText[]>([]);
  const timerRef = useRef<number | null>(null);

  const discardPending = useCallback(() => {
    pendingRef.current = [];
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clear = useCallback(() => {
    discardPending();
    setConsoleState(emptyConsole);
  }, [discardPending]);

  useEffect(() => {
    const commit = () => {
      timerRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = [];
      setConsoleState((state) => pending.reduce((next, item) => appendText(next, item.kind, item.text), state));
    };

    const controller = new RunnerController(createPyodideWorker, {
      status: setStatus,
      text: (kind, text) => {
        pendingRef.current.push({ kind, text });
        if (timerRef.current === null) timerRef.current = window.setTimeout(commit, COMMIT_INTERVAL_MS);
      },
      clear,
      awaitingInput: () => {},
    });
    controllerRef.current = controller;

    return () => {
      controller.dispose();
      controllerRef.current = null;
      discardPending();
    };
  }, [clear, discardPending]);

  const run = useCallback((code: string) => controllerRef.current?.run(code), []);
  const stop = useCallback(() => controllerRef.current?.stop(), []);
  const retry = useCallback(() => controllerRef.current?.retry(), []);

  return { status, consoleState, run, stop, retry, clear };
}
