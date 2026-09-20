import { useCallback, useEffect, useRef, useState } from "react";
import { appendText, emptyConsole, type ConsoleKind, type ConsoleState } from "./consoleModel";
import type { TestCase } from "../pads/padStore";
import { createPyodideWorker } from "./createPyodideWorker";
import type { CaseResult } from "./protocol";
import { RunnerController, type RunnerStatus } from "./runnerController";

// Console text is committed to React state at most this often, however fast it arrives.
const COMMIT_INTERVAL_MS = 32;

interface PendingText {
  kind: ConsoleKind;
  text: string;
}

export interface TestRunState {
  running: boolean;
  /** A package-loading message while the run is under way. */
  message: string | null;
  /** By case id. A case missing here has not been run (or was cut off by Stop). */
  results: Record<string, CaseResult>;
}

const NO_TEST_RUN: TestRunState = { running: false, message: null, results: {} };

export function usePythonRunner() {
  const [status, setStatus] = useState<RunnerStatus>("idle");
  const [consoleState, setConsoleState] = useState<ConsoleState>(emptyConsole);
  const [awaitingInput, setAwaitingInput] = useState(false);
  const [testRun, setTestRun] = useState<TestRunState>(NO_TEST_RUN);
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
      awaitingInput: (waiting) => {
        // The prompt was queued just before the request; show it before the field.
        if (waiting && timerRef.current !== null) {
          window.clearTimeout(timerRef.current);
          commit();
        }
        setAwaitingInput(waiting);
      },
      caseResult: (result) => setTestRun((state) => ({ ...state, results: { ...state.results, [result.id]: result } })),
      testsFinished: () => setTestRun((state) => ({ ...state, running: false, message: null })),
      testMessage: (message) => setTestRun((state) => ({ ...state, message })),
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
  const provideInput = useCallback((line: string) => controllerRef.current?.provideInput(line), []);
  const endInput = useCallback(() => controllerRef.current?.endInput(), []);
  const runTests = useCallback((code: string, cases: TestCase[]) => {
    const inputs = cases.map(({ id, input }) => ({ id, input }));
    if (!controllerRef.current?.runTests(code, inputs)) return;
    // Old results for these cases go now, so nothing stale shows while they re-run.
    setTestRun((state) => {
      const results = { ...state.results };
      for (const { id } of inputs) delete results[id];
      return { running: true, message: null, results };
    });
  }, []);

  return { status, consoleState, awaitingInput, testRun, run, stop, retry, clear, provideInput, endInput, runTests };
}
