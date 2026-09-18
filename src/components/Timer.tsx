import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { formatRemaining, type TimerState } from "../timer/timer";
import type { TimerControls } from "../timer/useTimer";
import { ChevronDownIcon, PauseIcon, PlayIcon, ResetIcon } from "./icons";
import { TimerLengthPopover } from "./TimerLengthPopover";

// How long "Reset?" waits for its confirming click.
const RESET_CONFIRM_MS = 3000;
// A confirming click this soon after the first is the second half of a double-click.
const DOUBLE_CLICK_MS = 400;

export function Timer({ timer }: { timer: TimerControls }) {
  const { state, phase } = timer;
  const popoverId = useId();
  const primaryRef = useRef<HTMLButtonElement>(null);
  const refocusPrimary = useRef(false);
  // Armed against one timer state, so any transition (pause, a palette command) disarms it.
  const [armed, setArmed] = useState<{ state: TimerState; at: number } | null>(null);

  const idle = state.status === "idle";
  const paused = state.status === "paused";
  const expired = phase === "expired";
  const resetArmed = armed !== null && armed.state === state && !expired;
  const minutes = Math.round(state.durationMs / 60_000);

  useEffect(() => {
    if (!resetArmed) return;
    const timeout = window.setTimeout(() => setArmed(null), RESET_CONFIRM_MS);
    return () => window.clearTimeout(timeout);
  }, [resetArmed]);

  // Reset removes the button that was just pressed; hand focus to Start instead of dropping it.
  useEffect(() => {
    if (!refocusPrimary.current) return;
    refocusPrimary.current = false;
    primaryRef.current?.focus();
  }, [state]);

  const onReset = (event: MouseEvent) => {
    // Once time is up there is no session left to protect.
    if (!expired && !resetArmed) {
      setArmed({ state, at: event.timeStamp });
      return;
    }
    if (armed && resetArmed && event.timeStamp - armed.at < DOUBLE_CLICK_MS) return;
    refocusPrimary.current = true;
    timer.reset();
  };

  const face = (
    <>
      <ProgressRing fraction={timer.fraction} />
      {expired ? <span className="timer-label">Time's up</span> : <Readout text={formatRemaining(timer.remainingMs)} />}
    </>
  );

  return (
    <>
      <div className={`timer timer-${phase} is-${state.status}`} role="timer" aria-label="Interview timer">
        {idle ? (
          <button type="button" className="timer-face" popoverTarget={popoverId} title="Change session length">
            <span className="visually-hidden">Session length, </span>
            {face}
            <ChevronDownIcon size={12} />
          </button>
        ) : (
          <div className="timer-face">{face}</div>
        )}

        <div className="timer-controls">
          {/* One button for Start, Pause and Resume, so keyboard focus survives each of them. */}
          {!expired && !resetArmed && (
            <button
              ref={primaryRef}
              type="button"
              className={idle ? "timer-start" : "icon-button timer-control"}
              aria-label={idle ? undefined : paused ? "Resume" : "Pause"}
              title={idle ? undefined : paused ? "Resume" : "Pause"}
              onClick={idle ? timer.start : paused ? timer.resume : timer.pause}
            >
              {idle ? "Start" : paused ? <PlayIcon size={14} /> : <PauseIcon size={14} />}
            </button>
          )}
          {!idle && (
            <button
              type="button"
              className={resetArmed ? "timer-control timer-confirm" : "icon-button timer-control"}
              aria-label={resetArmed ? undefined : "Reset"}
              title={resetArmed ? "Click again to reset the timer" : "Reset"}
              onClick={onReset}
              onBlur={() => setArmed(null)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setArmed(null);
              }}
            >
              {resetArmed ? "Reset?" : <ResetIcon size={14} />}
            </button>
          )}
        </div>
      </div>

      {idle && <TimerLengthPopover id={popoverId} minutes={minutes} onChange={timer.setMinutes} />}
    </>
  );
}

function Readout({ text }: { text: string }) {
  const [minutes, seconds] = text.split(":");
  return (
    <span className="timer-readout">
      {minutes}
      <span className="timer-colon">:</span>
      {seconds}
    </span>
  );
}

const RING_RADIUS = 6;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** Drains clockwise from 12 o'clock, so what is left of the ring is what is left of the session. */
function ProgressRing({ fraction }: { fraction: number }) {
  const left = fraction * RING_LENGTH;
  return (
    <svg className="timer-ring" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle className="timer-ring-track" cx="8" cy="8" r={RING_RADIUS} />
      <circle
        className="timer-ring-arc"
        cx="8"
        cy="8"
        r={RING_RADIUS}
        // A zero-length dash with round caps would still paint a dot.
        style={{ strokeDasharray: `${left} ${RING_LENGTH}`, strokeDashoffset: left - RING_LENGTH, opacity: left > 0 ? 1 : 0 }}
      />
    </svg>
  );
}
