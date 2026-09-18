import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { MAX_MINUTES, MIN_MINUTES, PRESET_MINUTES, clampMinutes, stepMinutes } from "../timer/timer";

interface TimerLengthPopoverProps {
  id: string;
  minutes: number;
  onChange(minutes: number): void;
}

/**
 * Picks the session length. A native popover gives it light dismiss, Escape to close and focus
 * restoration to the timer for free, the same way the palette leans on <dialog>.
 */
export function TimerLengthPopover({ id, minutes, onChange }: TimerLengthPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <div
      ref={popoverRef}
      id={id}
      popover="auto"
      role="dialog"
      aria-label="Session length"
      className="timer-popover"
      // Mount before it opens, so the body is in place for the first paint.
      onBeforeToggle={(event) => {
        if (event.newState === "open") setOpen(true);
      }}
      onToggle={(event) => {
        // Unmount only after it has closed: removing the focused control any earlier stops the
        // browser from handing focus back to the timer.
        if (event.newState === "closed") setOpen(false);
        // Nothing inside can take focus until the popover is showing. Starting on the ruler
        // means the arrow keys work straight away.
        else popoverRef.current?.querySelector<HTMLElement>('[role="slider"]')?.focus();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || event.target instanceof HTMLButtonElement) return;
        // Closing hands focus back to the timer's button; without this the same keystroke
        // would go on to press it and open the popover again.
        event.preventDefault();
        popoverRef.current?.hidePopover();
      }}
    >
      {/* Mounted per opening, so the clock and the typed draft start fresh each time. */}
      {open && <LengthBody minutes={minutes} onChange={onChange} />}
    </div>
  );
}

const CLOCK_REFRESH_MS = 10_000;
const clockFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function LengthBody({ minutes, onChange }: { minutes: number; onChange(minutes: number): void }) {
  // What is being typed, until it is committed; null shows the real length.
  const [draft, setDraft] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), CLOCK_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <>
      <div className="length-header">
        <span className="length-title">Session length</span>
        <span className="length-ends" title="If you start now">
          Ends at {clockFormat.format(now + minutes * 60_000)}
        </span>
      </div>

      {/* Centred on the needle below it, so the two read as one dial. */}
      <label className="length-value">
        <input
          type="number"
          className="length-input"
          aria-label="Minutes"
          min={MIN_MINUTES}
          max={MAX_MINUTES}
          value={draft ?? String(minutes)}
          onChange={(event) => {
            setDraft(event.target.value);
            const value = Number(event.target.value);
            if (event.target.value !== "" && Number.isFinite(value)) onChange(value);
          }}
          onBlur={() => setDraft(null)}
        />
        <span>min</span>
      </label>

      <LengthTape minutes={minutes} onChange={onChange} />

      <div className="length-presets">
        {PRESET_MINUTES.map((preset) => (
          <button
            key={preset}
            type="button"
            className="length-preset"
            aria-pressed={preset === minutes}
            onClick={() => {
              setDraft(null);
              onChange(preset);
            }}
          >
            {preset} min
          </button>
        ))}
      </div>
    </>
  );
}

/** Width of one minute on the ruler. The stylesheet draws its ticks from the same number. */
const MINUTE_PX = 7;
const LABEL_EVERY = 10;
const TAPE_LABELS = Array.from({ length: MAX_MINUTES / LABEL_EVERY }, (_, index) => (index + 1) * LABEL_EVERY);
// Pointer travel below this is a click on a spot, not a drag.
const DRAG_THRESHOLD_PX = 3;
const WHEEL_PX_PER_MINUTE = 20;

/**
 * A ruler that slides under a fixed needle, like a tuning dial: every minute from 1 to 180 is
 * reachable precisely without cramming the whole range into the popover's width.
 */
function LengthTape({ minutes, onChange }: { minutes: number; onChange(minutes: number): void }) {
  const tapeRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startOffset: number; moved: boolean } | null>(null);
  const wheelCarry = useRef(0);
  // Follows the pointer between minutes while dragging; null lets the ruler settle on the value.
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const offset = dragOffset ?? minutes * MINUTE_PX;

  useEffect(() => {
    const tape = tapeRef.current;
    if (!tape) return;
    // Native and non-passive: React's onWheel cannot preventDefault, and an unhandled
    // horizontal swipe would navigate back.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      wheelCarry.current += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : -event.deltaY;
      const steps = Math.trunc(wheelCarry.current / WHEEL_PX_PER_MINUTE);
      if (steps === 0) return;
      wheelCarry.current -= steps * WHEEL_PX_PER_MINUTE;
      onChange(clampMinutes(minutes + steps));
    };
    tape.addEventListener("wheel", onWheel, { passive: false });
    return () => tape.removeEventListener("wheel", onWheel);
  }, [minutes, onChange]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startOffset: minutes * MINUTE_PX, moved: false };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const travel = event.clientX - drag.startX;
    if (Math.abs(travel) > DRAG_THRESHOLD_PX) drag.moved = true;
    if (!drag.moved) return;
    // Pulling the ruler left brings later minutes under the needle.
    const next = Math.min(MAX_MINUTES * MINUTE_PX, Math.max(MIN_MINUTES * MINUTE_PX, drag.startOffset - travel));
    setDragOffset(next);
    const nextMinutes = Math.round(next / MINUTE_PX);
    if (nextMinutes !== minutes) onChange(nextMinutes);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragOffset(null);
    if (!drag || drag.moved || event.type === "pointercancel") return;
    // A plain click: bring the minute under the pointer to the needle.
    const bounds = event.currentTarget.getBoundingClientRect();
    const fromNeedle = event.clientX - (bounds.left + bounds.width / 2);
    onChange(clampMinutes(minutes + fromNeedle / MINUTE_PX));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = keyTarget(event.key, event.shiftKey, minutes);
    if (next === null) return;
    event.preventDefault();
    onChange(next);
  };

  return (
    <div
      ref={tapeRef}
      className={dragOffset === null ? "tape" : "tape is-dragging"}
      role="slider"
      tabIndex={0}
      aria-label="Session length ruler"
      aria-orientation="horizontal"
      aria-valuemin={MIN_MINUTES}
      aria-valuemax={MAX_MINUTES}
      aria-valuenow={minutes}
      aria-valuetext={`${minutes} minutes`}
      style={{ "--minute": `${MINUTE_PX}px` } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      {/* The edge fade lives on an inner element so it cannot clip the focus ring. */}
      <div className="tape-window">
        <div className="tape-strip" style={{ width: MAX_MINUTES * MINUTE_PX + 1, transform: `translateX(${-offset}px)` }}>
          {TAPE_LABELS.map((label) => (
            <span key={label} className="tape-label" style={{ left: label * MINUTE_PX }}>
              {label}
            </span>
          ))}
        </div>
      </div>
      <span className="tape-needle" />
    </div>
  );
}

/** Slider keys: arrows move a minute, Shift+arrow and Page keys move to the next multiple of five. */
function keyTarget(key: string, shift: boolean, minutes: number): number | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return shift ? stepMinutes(minutes, 1) : clampMinutes(minutes + 1);
    case "ArrowLeft":
    case "ArrowDown":
      return shift ? stepMinutes(minutes, -1) : clampMinutes(minutes - 1);
    case "PageUp":
      return stepMinutes(minutes, 1);
    case "PageDown":
      return stepMinutes(minutes, -1);
    case "Home":
      return MIN_MINUTES;
    case "End":
      return MAX_MINUTES;
    default:
      return null;
  }
}
