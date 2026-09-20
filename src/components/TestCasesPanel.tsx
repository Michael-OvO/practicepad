import { useState } from "react";
import type { TestCase } from "../pads/padStore";
import { RUN_TESTS_SHORTCUT_LABEL } from "../platform";
import { judge, summarizeVerdicts, type Verdict } from "../runner/judge";
import type { CaseResult } from "../runner/protocol";
import type { RunnerStatus } from "../runner/runnerController";
import type { TestRunState } from "../runner/usePythonRunner";
import { PlayIcon, PlusIcon, StopIcon } from "./icons";

type TestPatch = Partial<Pick<TestCase, "input" | "expected">>;

interface TestCasesPanelProps {
  /** Read live, so a case's textareas seed from the latest text (the rendered copy lags while typing). */
  tests: TestCase[];
  testRun: TestRunState;
  status: RunnerStatus;
  onAdd(id: string): void;
  onRemove(testId: string): void;
  onChange(testId: string, patch: TestPatch): void;
  onRun(): void;
  onStop(): void;
}

const MARKS: Record<Verdict, string> = { passed: "✓", failed: "✗", error: "✗", ran: "·" };

/** The Test cases tab: chips for each case, the selected case's fields and result, and Run tests. */
export function TestCasesPanel({ tests, testRun, status, onAdd, onRemove, onChange, onRun, onStop }: TestCasesPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = tests.find((test) => test.id === selectedId) ?? tests[0];

  const verdictOf = (test: TestCase): Verdict | null => {
    const result = testRun.results[test.id];
    return result ? judge(result, test.expected) : null;
  };
  const summary = summarizeVerdicts(tests.map(verdictOf).filter((verdict): verdict is Verdict => verdict !== null));

  const add = () => {
    const id = crypto.randomUUID();
    onAdd(id);
    setSelectedId(id);
  };
  const remove = () => {
    if (!selected) return;
    const index = tests.indexOf(selected);
    onRemove(selected.id);
    setSelectedId(tests[index + 1]?.id ?? tests[index - 1]?.id ?? null);
  };

  // A run queued while Python loads is fine; a run in progress is not.
  const canRun = tests.length > 0 && status !== "running" && status !== "error";

  return (
    <div id="panel-tests" className="tests-panel" role="tabpanel" aria-labelledby="tab-tests">
      <div className="case-chips">
        {tests.map((test, index) => {
          const verdict = verdictOf(test);
          const running = testRun.running && !testRun.results[test.id];
          return (
            <button
              key={test.id}
              type="button"
              className={`case-chip${verdict ? ` is-${verdict}` : ""}${running ? " is-running" : ""}`}
              aria-pressed={test === selected}
              onClick={() => setSelectedId(test.id)}
            >
              Case {index + 1}
              <span className="case-mark" aria-hidden="true">
                {verdict ? MARKS[verdict] : "·"}
              </span>
            </button>
          );
        })}
        <button type="button" className="icon-button" aria-label="Add test case" title="Add test case" onClick={add}>
          <PlusIcon />
        </button>
      </div>

      {selected ? (
        <CaseEditor
          // Remounted per case, so the textareas seed from that case's text.
          key={selected.id}
          test={selected}
          result={testRun.results[selected.id]}
          running={testRun.running && !testRun.results[selected.id]}
          onChange={onChange}
          onRemove={remove}
        />
      ) : (
        <p className="console-hint case-hint">
          No test cases yet. Add one to run your program against a fixed input and check what it prints.
        </p>
      )}

      <footer className="tests-footer">
        {testRun.running ? (
          <button type="button" className="run-button is-stop" onClick={onStop}>
            <StopIcon />
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="run-button"
            title={tests.length === 0 ? "Add a test case first" : `Run tests (${RUN_TESTS_SHORTCUT_LABEL})`}
            disabled={!canRun}
            onClick={onRun}
          >
            <PlayIcon />
            Run tests
            <kbd className="keycap" aria-hidden="true">
              {RUN_TESTS_SHORTCUT_LABEL}
            </kbd>
          </button>
        )}
        <span className="tests-summary" aria-live="polite">
          {testRun.message ?? summary}
        </span>
      </footer>
    </div>
  );
}

interface CaseEditorProps {
  test: TestCase;
  result: CaseResult | undefined;
  running: boolean;
  onChange(testId: string, patch: TestPatch): void;
  onRemove(): void;
}

function statusLine(result: CaseResult | undefined, verdict: Verdict | null, running: boolean): string {
  if (running) return "Running…";
  if (!result || !verdict) return "Not run";
  const took = `${Math.max(1, Math.round(result.durationMs))} ms`;
  switch (verdict) {
    case "passed":
      return `Passed · ${took}`;
    case "failed":
      return `Failed · ${took}`;
    case "error":
      return `Error · exit code ${result.exitCode} · ${took}`;
    case "ran":
      return `Ran · ${took}`;
  }
}

function CaseEditor({ test, result, running, onChange, onRemove }: CaseEditorProps) {
  const verdict = result ? judge(result, test.expected) : null;

  return (
    <div className="case-body">
      <label className="case-field">
        <span className="case-label">Input</span>
        <textarea
          className="case-textarea"
          aria-label="Test input"
          placeholder="What the program reads from stdin, one line per input()"
          // Uncontrolled, like the code editor: keystrokes then need no render of the app.
          defaultValue={test.input}
          spellCheck={false}
          onChange={(event) => onChange(test.id, { input: event.target.value })}
        />
      </label>
      <div className="case-columns">
        <label className="case-field">
          <span className="case-label">Expected output</span>
          <textarea
            className="case-textarea"
            aria-label="Expected output"
            placeholder="Leave empty to just see the output"
            defaultValue={test.expected}
            spellCheck={false}
            onChange={(event) => onChange(test.id, { expected: event.target.value })}
          />
        </label>
        {result && (
          <div className="case-field">
            <span className="case-label">Actual output</span>
            <pre className="case-output" aria-label="Actual output">
              {result.stdout}
              {result.truncated && <span className="console-system">… truncated</span>}
            </pre>
            {result.stderr !== "" && (
              <pre className="case-output is-stderr" aria-label="Error output">
                {result.stderr}
              </pre>
            )}
          </div>
        )}
      </div>
      <div className={`case-status${verdict ? ` is-${verdict}` : ""}`}>{statusLine(result, verdict, running)}</div>
      <button type="button" className="text-button case-delete" onClick={onRemove}>
        Delete case
      </button>
    </div>
  );
}
