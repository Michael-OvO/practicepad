import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { getStorage } from "../storage";

const SPLIT_KEY = "coderpad-sim:split";
const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;
const DEFAULT_RATIO = 0.58;
const KEY_STEP = 0.02;

const clamp = (ratio: number) => Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));

function loadRatio(): number {
  const saved = Number(getStorage()?.getItem(SPLIT_KEY));
  return Number.isFinite(saved) && saved > 0 ? clamp(saved) : DEFAULT_RATIO;
}

function saveRatio(ratio: number): void {
  try {
    getStorage()?.setItem(SPLIT_KEY, String(ratio));
  } catch {
    // Losing the divider position is harmless.
  }
}

export function SplitPane({ left, right }: { left: ReactNode; right: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(loadRatio);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // Capturing the pointer keeps the drag alive while the cursor is over the editor.
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging || !containerRef.current) return;
    const bounds = containerRef.current.getBoundingClientRect();
    setRatio(clamp((event.clientX - bounds.left) / bounds.width));
  };

  const onPointerUp = () => {
    if (!dragging) return;
    setDragging(false);
    saveRatio(ratio);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = clamp(ratio + (event.key === "ArrowLeft" ? -KEY_STEP : KEY_STEP));
    setRatio(next);
    saveRatio(next);
  };

  return (
    <div
      ref={containerRef}
      className={`split${dragging ? " is-dragging" : ""}`}
      style={{ "--split": ratio } as CSSProperties}
    >
      {left}
      <div
        className="split-divider"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize editor and output"
        aria-valuemin={MIN_RATIO * 100}
        aria-valuemax={MAX_RATIO * 100}
        aria-valuenow={Math.round(ratio * 100)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      />
      {right}
    </div>
  );
}
