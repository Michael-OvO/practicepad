export type TimerState =
  | { status: "idle"; durationMs: number }
  | { status: "running"; durationMs: number; endsAt: number }
  | { status: "paused"; durationMs: number; remainingMs: number };

export type TimerPhase = "normal" | "warning" | "expired";

export const TIMER_KEY = "coderpad-sim:timer";
export const PRESET_MINUTES: readonly number[] = [30, 45, 60];
export const DEFAULT_MINUTES = 45;
export const MIN_MINUTES = 1;
export const MAX_MINUTES = 180;

const MINUTE_MS = 60_000;
const WARNING_MS = 5 * MINUTE_MS;
const STEP_MINUTES = 5;

export function clampMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return DEFAULT_MINUTES;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(minutes)));
}

/** The custom length one step up or down: the neighbouring multiple of five. */
export function stepMinutes(minutes: number, direction: 1 | -1): number {
  const stepped =
    direction === 1
      ? (Math.floor(minutes / STEP_MINUTES) + 1) * STEP_MINUTES
      : (Math.ceil(minutes / STEP_MINUTES) - 1) * STEP_MINUTES;
  return clampMinutes(stepped);
}

export function idleTimer(minutes: number = DEFAULT_MINUTES): TimerState {
  return { status: "idle", durationMs: clampMinutes(minutes) * MINUTE_MS };
}

export function remainingMs(state: TimerState, now: number): number {
  switch (state.status) {
    case "idle":
      return state.durationMs;
    case "paused":
      return state.remainingMs;
    case "running":
      return Math.max(0, state.endsAt - now);
  }
}

/** Share of the session still left, from 1 down to 0. Stored states are not trusted to be sane. */
export function remainingFraction(state: TimerState, now: number): number {
  if (state.durationMs <= 0) return 0;
  return Math.min(1, remainingMs(state, now) / state.durationMs);
}

export function start(state: TimerState, now: number): TimerState {
  if (state.status !== "idle") return state;
  return { status: "running", durationMs: state.durationMs, endsAt: now + state.durationMs };
}

export function pause(state: TimerState, now: number): TimerState {
  if (state.status !== "running") return state;
  return { status: "paused", durationMs: state.durationMs, remainingMs: remainingMs(state, now) };
}

export function resume(state: TimerState, now: number): TimerState {
  if (state.status !== "paused") return state;
  return { status: "running", durationMs: state.durationMs, endsAt: now + state.remainingMs };
}

export function reset(state: TimerState): TimerState {
  return { status: "idle", durationMs: state.durationMs };
}

export function setDuration(state: TimerState, minutes: number): TimerState {
  return state.status === "idle" ? idleTimer(minutes) : state;
}

export function timerPhase(state: TimerState, now: number): TimerPhase {
  if (state.status === "idle") return "normal";
  const left = remainingMs(state, now);
  if (left === 0) return "expired";
  return left <= WARNING_MS ? "warning" : "normal";
}

export function formatRemaining(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Browser tab title, so the clock can be read from another tab. */
export function timerTitle(state: TimerState, now: number, appTitle: string): string {
  if (state.status === "idle") return appTitle;
  if (timerPhase(state, now) === "expired") return `Time's up · ${appTitle}`;
  const left = formatRemaining(remainingMs(state, now));
  return `${left}${state.status === "paused" ? " paused" : ""} · ${appTitle}`;
}

export function parseTimer(raw: string | null): TimerState {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (typeof value !== "object" || value === null) return idleTimer();
    const timer = value as Record<string, unknown>;
    if (typeof timer.durationMs !== "number") return idleTimer();
    if (timer.status === "idle") return { status: "idle", durationMs: timer.durationMs };
    if (timer.status === "running" && typeof timer.endsAt === "number") {
      return { status: "running", durationMs: timer.durationMs, endsAt: timer.endsAt };
    }
    if (timer.status === "paused" && typeof timer.remainingMs === "number") {
      return { status: "paused", durationMs: timer.durationMs, remainingMs: timer.remainingMs };
    }
    return idleTimer();
  } catch {
    return idleTimer();
  }
}
