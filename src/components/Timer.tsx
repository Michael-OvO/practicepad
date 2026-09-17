import { useState } from "react";
import { MAX_MINUTES, MIN_MINUTES, PRESET_MINUTES, formatRemaining } from "../timer/timer";
import type { TimerControls } from "../timer/useTimer";

export function Timer({ timer }: { timer: TimerControls }) {
  const { state, phase } = timer;
  const minutes = Math.round(state.durationMs / 60_000);
  const [customOpen, setCustomOpen] = useState(() => !PRESET_MINUTES.includes(minutes));
  const [customDraft, setCustomDraft] = useState(String(minutes));
  const idle = state.status === "idle";

  return (
    <div className={`timer timer-${phase}`} role="timer" aria-label="Interview timer">
      <span className="timer-readout">{phase === "expired" ? "Time's up" : formatRemaining(timer.remainingMs)}</span>

      {idle && (
        <select
          aria-label="Interview length"
          value={customOpen ? "custom" : String(minutes)}
          onChange={(event) => {
            if (event.target.value === "custom") {
              setCustomOpen(true);
              setCustomDraft(String(minutes));
            } else {
              setCustomOpen(false);
              timer.setMinutes(Number(event.target.value));
            }
          }}
        >
          {PRESET_MINUTES.map((preset) => (
            <option key={preset} value={preset}>
              {preset} min
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
      )}

      {idle && customOpen && (
        <input
          type="number"
          aria-label="Custom length in minutes"
          min={MIN_MINUTES}
          max={MAX_MINUTES}
          value={customDraft}
          onChange={(event) => {
            setCustomDraft(event.target.value);
            const value = Number(event.target.value);
            if (event.target.value !== "" && Number.isFinite(value)) timer.setMinutes(value);
          }}
          onBlur={() => setCustomDraft(String(Math.round(timer.state.durationMs / 60_000)))}
        />
      )}

      {idle && (
        <button type="button" className="text-button" onClick={timer.start}>
          Start
        </button>
      )}
      {state.status === "running" && phase !== "expired" && (
        <button type="button" className="text-button" onClick={timer.pause}>
          Pause
        </button>
      )}
      {state.status === "paused" && phase !== "expired" && (
        <button type="button" className="text-button" onClick={timer.resume}>
          Resume
        </button>
      )}
      {!idle && (
        <button type="button" className="text-button" onClick={timer.reset}>
          Reset
        </button>
      )}
    </div>
  );
}
