import { RUN_SHORTCUT_LABEL } from "../platform";
import type { RunnerStatus } from "../runner/runnerController";
import { PlayIcon, StopIcon } from "./icons";

interface EditorToolbarProps {
  status: RunnerStatus;
  onRun(): void;
  onStop(): void;
}

/** Sits above the editor with Run in the top-left corner, where CoderPad puts it. */
export function EditorToolbar({ status, onRun, onStop }: EditorToolbarProps) {
  return (
    <header className="pane-header editor-toolbar">
      {status === "running" ? (
        <button type="button" className="run-button is-stop" onClick={onStop}>
          <StopIcon />
          Stop
        </button>
      ) : (
        <button
          type="button"
          className="run-button"
          title={status === "ready" ? `Run (${RUN_SHORTCUT_LABEL})` : "Python is still loading"}
          onClick={onRun}
          disabled={status !== "ready"}
        >
          <PlayIcon />
          Run
          <kbd className="keycap" aria-hidden="true">
            {RUN_SHORTCUT_LABEL}
          </kbd>
        </button>
      )}
      <span className="file-tab" aria-current="page">
        main.py
      </span>
    </header>
  );
}
