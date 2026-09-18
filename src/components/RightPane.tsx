import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { RUN_SHORTCUT_LABEL } from "../platform";
import type { ConsoleState } from "../runner/consoleModel";
import type { RunnerStatus } from "../runner/runnerController";

export type RightTab = "output" | "notes";

interface RightPaneProps {
  tab: RightTab;
  consoleState: ConsoleState;
  status: RunnerStatus;
  /** The program is blocked reading stdin: show the field. */
  awaitingInput: boolean;
  padId: string;
  /** Only used when a pad's notes are first shown; after that the textarea owns the text. */
  initialNotes: string;
  onTabChange(tab: RightTab): void;
  onNotesChange(notes: string): void;
  onClear(): void;
  onRetry(): void;
  onInput(line: string): void;
  onEndInput(): void;
}

const TABS: { id: RightTab; label: string }[] = [
  { id: "output", label: "Program Output" },
  { id: "notes", label: "Notes" },
];

/** The right-hand pane: tabbed like CoderPad's, with the program output first. */
export function RightPane(props: RightPaneProps) {
  const { tab, consoleState, onTabChange, onClear } = props;

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = tab === "output" ? "notes" : "output";
    onTabChange(next);
    document.getElementById(`tab-${next}`)?.focus();
  };

  return (
    <section className="split-pane right-pane">
      <header className="pane-header">
        <div className="tabs" role="tablist" aria-label="Right pane">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              id={`tab-${id}`}
              type="button"
              role="tab"
              className="tab"
              aria-selected={tab === id}
              aria-controls={`panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => onTabChange(id)}
              onKeyDown={onTabKeyDown}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "output" && (
          <button type="button" className="text-button" onClick={onClear} disabled={consoleState.segments.length === 0}>
            Clear
          </button>
        )}
      </header>
      {tab === "output" ? <OutputPanel {...props} /> : <NotesPanel {...props} />}
    </section>
  );
}

const STICK_THRESHOLD_PX = 24;

function OutputPanel({ consoleState, status, awaitingInput, onRetry, onInput, onEndInput }: RightPaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const isEmpty = consoleState.segments.length === 0 && !awaitingInput;

  // Follow new output unless the user has scrolled up to read something.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (isEmpty) stickToBottom.current = true;
    if (stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [consoleState, isEmpty, awaitingInput]);

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onInput(event.currentTarget.value);
    } else if (event.key === "d" && event.ctrlKey) {
      // End-of-file, as in a terminal.
      event.preventDefault();
      onEndInput();
    }
  };

  return (
    <div
      id="panel-output"
      className="console-scroll"
      role="tabpanel"
      aria-label="Program output"
      tabIndex={0}
      ref={scrollRef}
      onScroll={(event) => {
        const element = event.currentTarget;
        stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < STICK_THRESHOLD_PX;
      }}
    >
      {isEmpty ? (
        <p className="console-hint">
          Press <strong>Run</strong> or <kbd className="keycap">{RUN_SHORTCUT_LABEL}</kbd> to execute your code. Output,
          errors, and package installs show up here.
        </p>
      ) : (
        <pre className="console-text">
          {consoleState.truncated && <span className="console-system">… earlier output truncated{"\n"}</span>}
          {consoleState.segments.map((segment) => (
            <span key={segment.id} className={`console-${segment.kind === "input" ? "input-echo" : segment.kind}`}>
              {segment.text}
            </span>
          ))}
          {awaitingInput && (
            // Inline, right after the prompt the program printed. Mounted per read, so it is
            // empty and focused each time.
            <input
              className="console-input"
              aria-label="Program input"
              autoFocus
              spellCheck={false}
              autoComplete="off"
              onKeyDown={onInputKeyDown}
            />
          )}
        </pre>
      )}
      {status === "error" && (
        <button type="button" className="text-button console-retry" onClick={onRetry}>
          Retry loading Python
        </button>
      )}
    </div>
  );
}

function NotesPanel({ padId, initialNotes, onNotesChange }: RightPaneProps) {
  return (
    <div id="panel-notes" className="notes-panel" role="tabpanel" aria-labelledby="tab-notes">
      <textarea
        // Keyed per pad so switching pads never carries a cursor or undo history across.
        key={padId}
        className="notes-input"
        aria-label="Notes for this pad"
        placeholder="Problem statement, examples, edge cases, your approach. Saved with this pad."
        // Uncontrolled, like the code editor: keystrokes then need no render of the app.
        defaultValue={initialNotes}
        spellCheck={false}
        onChange={(event) => onNotesChange(event.target.value)}
      />
    </div>
  );
}
