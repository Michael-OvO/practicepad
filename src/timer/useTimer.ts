import { useCallback, useEffect, useState } from "react";
import { getStorage } from "../storage";
import {
  TIMER_KEY,
  parseTimer,
  pause as pauseTimer,
  remainingMs,
  reset as resetTimer,
  resume as resumeTimer,
  setDuration,
  start as startTimer,
  timerPhase,
  type TimerPhase,
  type TimerState,
} from "./timer";

const TICK_MS = 250;

export interface TimerControls {
  state: TimerState;
  remainingMs: number;
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
    const interval = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(interval);
  }, [state.status]);

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

  return { state, remainingMs: remainingMs(state, now), phase: timerPhase(state, now), start, pause, resume, reset, setMinutes };
}
