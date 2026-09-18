import { useCallback, useEffect, useState } from "react";
import { getStorage } from "../storage";
import { createTicker } from "./createTicker";
import {
  TIMER_KEY,
  parseTimer,
  pause as pauseTimer,
  remainingFraction,
  remainingMs,
  reset as resetTimer,
  resume as resumeTimer,
  setDuration,
  start as startTimer,
  timerPhase,
  timerTitle,
  type TimerPhase,
  type TimerState,
} from "./timer";

const TICK_MS = 250;
// Matches <title> in index.html.
const APP_TITLE = "PracticePad";

export interface TimerControls {
  state: TimerState;
  remainingMs: number;
  /** Share of the session still left, from 1 down to 0. */
  fraction: number;
  phase: TimerPhase;
  start(): void;
  pause(): void;
  resume(): void;
  reset(): void;
  setMinutes(minutes: number): void;
}

export function useTimer(): TimerControls {
  const [state, setState] = useState<TimerState>(() => parseTimer(getStorage()?.getItem(TIMER_KEY) ?? null));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    try {
      getStorage()?.setItem(TIMER_KEY, JSON.stringify(state));
    } catch {
      // The timer still works for this session without persistence.
    }
  }, [state]);

  useEffect(() => {
    if (state.status !== "running") return;
    return createTicker(() => setNow(Date.now()), TICK_MS);
  }, [state.status]);

  // Keeps the countdown readable from another tab.
  const title = timerTitle(state, now, APP_TITLE);
  useEffect(() => {
    document.title = title;
  }, [title]);

  // Every transition also refreshes `now`, so the readout never uses a stale clock.
  const apply = useCallback((transition: (current: TimerState, at: number) => TimerState) => {
    const at = Date.now();
    setNow(at);
    setState((current) => transition(current, at));
  }, []);

  const start = useCallback(() => apply(startTimer), [apply]);
  const pause = useCallback(() => apply(pauseTimer), [apply]);
  const resume = useCallback(() => apply(resumeTimer), [apply]);
  const reset = useCallback(() => apply((current) => resetTimer(current)), [apply]);
  const setMinutes = useCallback((minutes: number) => apply((current) => setDuration(current, minutes)), [apply]);

  return {
    state,
    remainingMs: remainingMs(state, now),
    fraction: remainingFraction(state, now),
    phase: timerPhase(state, now),
    start,
    pause,
    resume,
    reset,
    setMinutes,
  };
}
