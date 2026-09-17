import { useSyncExternalStore } from "react";
import type { CursorStore } from "../cursorStore";
import type { RunnerStatus } from "../runner/runnerController";

interface StatusBarProps {
  status: RunnerStatus;
  saveFailed: boolean;
  cursorStore: CursorStore;
}

const STATUS_TEXT: Record<RunnerStatus, string> = {
  loading: "Loading Python…",
  ready: "Python ready",
  running: "Running…",
  error: "Python unavailable",
};

export function StatusBar({ status, saveFailed, cursorStore }: StatusBarProps) {
  const cursor = useSyncExternalStore(cursorStore.subscribe, cursorStore.get);
  return (
    <footer className="statusbar">
      <span className="status-item">Python 3.14</span>
      <span className="status-item">Spaces: 4</span>
      <span className="status-item">
        Ln {cursor.line}, Col {cursor.column}
      </span>
      <div className="statusbar-spacer" />
      {saveFailed ? (
        <span className="status-item is-warning" role="alert">
          Not saved: this browser is blocking storage
        </span>
      ) : (
        <span className="status-item">Saved in this browser</span>
      )}
      <span className={`status-item runtime runtime-${status}`} role="status">
        <span className="runtime-dot" aria-hidden="true" />
        {STATUS_TEXT[status]}
      </span>
    </footer>
  );
}
