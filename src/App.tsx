import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Command } from "./commands/commandSearch";
import { ActivityRail } from "./components/ActivityRail";
import { CodeEditor } from "./components/CodeEditor";
import { CommandPalette } from "./components/CommandPalette";
import { EditorToolbar } from "./components/EditorToolbar";
import { PadSidebar } from "./components/PadSidebar";
import { RightPane, type RightTab } from "./components/RightPane";
import { SplitPane } from "./components/SplitPane";
import { StatusBar } from "./components/StatusBar";
import { TestCasesPanel } from "./components/TestCasesPanel";
import { Timer } from "./components/Timer";
import { PAD_TITLE_INPUT_ID, TopBar } from "./components/TopBar";
import { CursorStore } from "./cursorStore";
import { sortedByRecent } from "./pads/padStore";
import { usePads } from "./pads/usePads";
import { PALETTE_SHORTCUT_LABEL, RUN_SHORTCUT_LABEL, RUN_TESTS_SHORTCUT_LABEL } from "./platform";
import { usePythonRunner } from "./runner/usePythonRunner";
import { useTheme } from "./theme/useTheme";
import { PRESET_MINUTES } from "./timer/timer";
import { useTimer } from "./timer/useTimer";

const SIDEBAR_MIN_WIDTH_PX = 900;
// Matches the breakpoint in styles.css where the pads panel floats over the editor.
const FLOATING_SIDEBAR_QUERY = "(max-width: 760px)";

export function App() {
  const pads = usePads();
  const runner = usePythonRunner();
  const timer = useTimer();
  const theme = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= SIDEBAR_MIN_WIDTH_PX);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [rightTab, setRightTab] = useState<RightTab>("output");
  // Not React state: the cursor moves on every keystroke and only the status bar reads it.
  const [cursorStore] = useState(() => new CursorStore());
  const focusEditorRef = useRef<(() => void) | null>(null);

  const { active, updateCode, updateNotes, rename, select, create, remove, addTest, updateTest, removeTest, getActive } = pads;
  const { run, runTests, stop, clear, status } = runner;

  // Read from the pad session, not from render state, so Run sees the very last keystroke.
  const runActive = useCallback(() => {
    setRightTab("output");
    run(getActive().code);
  }, [run, getActive]);
  const runTestsActive = useCallback(() => {
    setRightTab("tests");
    const pad = getActive();
    runTests(pad.code, pad.tests);
  }, [runTests, getActive]);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // The editor handles these itself and marks the event; don't act twice.
      if (event.defaultPrevented || !(event.metaKey || event.ctrlKey)) return;
      if (event.key === "Enter") {
        event.preventDefault();
        if (event.shiftKey) runTestsActive();
        else runActive();
      } else if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runActive, runTestsActive]);

  // A floating pads panel covers the editor, so get it out of the way once a pad is chosen.
  const closeFloatingSidebar = useCallback(() => {
    if (window.matchMedia(FLOATING_SIDEBAR_QUERY).matches) setSidebarOpen(false);
  }, []);
  const handleSelect = useCallback(
    (id: string) => {
      select(id);
      closeFloatingSidebar();
    },
    [select, closeFloatingSidebar],
  );
  const handleCreate = useCallback(() => {
    create();
    closeFloatingSidebar();
  }, [create, closeFloatingSidebar]);

  const handleChange = useCallback((code: string) => updateCode(active.id, code), [updateCode, active.id]);
  const handleNotes = useCallback((notes: string) => updateNotes(active.id, notes), [updateNotes, active.id]);
  const handleRename = useCallback((title: string) => rename(active.id, title), [rename, active.id]);
  const handleAddTest = useCallback((id: string) => addTest(active.id, id), [addTest, active.id]);
  const handleChangeTest = useCallback(
    (testId: string, patch: { input?: string; expected?: string }) => updateTest(active.id, testId, patch),
    [updateTest, active.id],
  );
  const handleRemoveTest = useCallback((testId: string) => removeTest(active.id, testId), [removeTest, active.id]);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      status === "running"
        ? { id: "stop", title: "Stop execution", section: "Run", keywords: "kill cancel interrupt", run: stop }
        : { id: "run", title: "Run code", section: "Run", shortcut: RUN_SHORTCUT_LABEL, keywords: "execute", run: runActive },
      {
        id: "run-tests",
        title: "Run test cases",
        section: "Run",
        shortcut: RUN_TESTS_SHORTCUT_LABEL,
        keywords: "check judge cases stdin",
        run: runTestsActive,
      },
      { id: "clear", title: "Clear output", section: "Run", keywords: "console reset", run: clear },

      { id: "new-pad", title: "New pad", section: "Pads", keywords: "create add", run: handleCreate },
      {
        id: "rename-pad",
        title: "Rename this pad",
        section: "Pads",
        keywords: "title",
        run: () => {
          const input = document.getElementById(PAD_TITLE_INPUT_ID) as HTMLInputElement | null;
          input?.focus();
          input?.select();
        },
      },
      {
        id: "delete-pad",
        title: "Delete this pad…",
        section: "Pads",
        keywords: "remove",
        run: () => {
          if (window.confirm(`Delete "${active.title}"? This can't be undone.`)) remove(active.id);
        },
      },
      ...sortedByRecent(pads.pads)
        .filter((pad) => pad.id !== active.id)
        .map((pad) => ({
          id: `pad:${pad.id}`,
          title: `Go to pad: ${pad.title}`,
          section: "Pads",
          keywords: "switch open",
          run: () => handleSelect(pad.id),
        })),
    ];

    if (timer.state.status === "idle") {
      list.push({ id: "timer-start", title: "Timer: Start", section: "Timer", keywords: "begin countdown", run: timer.start });
      for (const minutes of PRESET_MINUTES) {
        list.push({
          id: `timer-set-${minutes}`,
          title: `Timer: Set to ${minutes} minutes`,
          section: "Timer",
          keywords: "length duration",
          run: () => timer.setMinutes(minutes),
        });
      }
    } else {
      if (timer.state.status === "running" && timer.phase !== "expired") {
        list.push({ id: "timer-pause", title: "Timer: Pause", section: "Timer", keywords: "hold", run: timer.pause });
      }
      if (timer.state.status === "paused") {
        list.push({ id: "timer-resume", title: "Timer: Resume", section: "Timer", keywords: "continue", run: timer.resume });
      }
      list.push({ id: "timer-reset", title: "Timer: Reset", section: "Timer", keywords: "restart clear", run: timer.reset });
    }

    list.push(
      { id: "focus-editor", title: "Focus editor", section: "View", keywords: "code", run: () => focusEditorRef.current?.() },
      { id: "show-output", title: "Show program output", section: "View", keywords: "console tab", run: () => setRightTab("output") },
      { id: "show-tests", title: "Show test cases", section: "View", keywords: "tab", run: () => setRightTab("tests") },
      { id: "show-notes", title: "Show notes", section: "View", keywords: "tab", run: () => setRightTab("notes") },
      {
        id: "toggle-pads",
        title: sidebarOpen ? "Hide pads panel" : "Show pads panel",
        section: "View",
        keywords: "sidebar toggle",
        run: () => setSidebarOpen((open) => !open),
      },
      { id: "theme-light", title: "Theme: Light", section: "View", keywords: "day bright", run: () => theme.setPreference("light") },
      { id: "theme-dark", title: "Theme: Dark", section: "View", keywords: "night", run: () => theme.setPreference("dark") },
      {
        id: "theme-system",
        title: "Theme: Match system",
        section: "View",
        keywords: "auto os",
        run: () => theme.setPreference("system"),
      },
    );
    return list;
  }, [status, stop, runActive, runTestsActive, clear, handleCreate, handleSelect, active.id, active.title, remove, pads.pads, timer, sidebarOpen, theme]);

  return (
    <div className="app">
      <TopBar
        padId={active.id}
        title={active.title}
        timer={<Timer timer={timer} />}
        onRename={handleRename}
        onOpenPalette={openPalette}
      />
      <div className="workspace">
        <ActivityRail
          padsOpen={sidebarOpen}
          theme={theme.theme}
          onTogglePads={() => setSidebarOpen((open) => !open)}
          onToggleTheme={theme.toggle}
        />
        {sidebarOpen && (
          <PadSidebar
            pads={pads.pads}
            activeId={active.id}
            onCreate={handleCreate}
            onSelect={handleSelect}
            onRename={rename}
            onDelete={remove}
          />
        )}
        <SplitPane
          left={
            <section className="split-pane" aria-label="Code editor">
              <EditorToolbar status={status} onRun={runActive} onStop={stop} />
              <div className="editor-host">
                <CodeEditor
                  padId={active.id}
                  // Read live: the rendered snapshot's copy of the text lags behind the editor.
                  initialCode={getActive().code}
                  theme={theme.theme}
                  focusRef={focusEditorRef}
                  onChange={handleChange}
                  onRun={runActive}
                  onRunTests={runTestsActive}
                  onOpenPalette={openPalette}
                  onCursorChange={cursorStore.set}
                />
              </div>
            </section>
          }
          right={
            <RightPane
              tab={rightTab}
              consoleState={runner.consoleState}
              status={status}
              awaitingInput={runner.awaitingInput}
              padId={active.id}
              initialNotes={getActive().notes}
              onTabChange={setRightTab}
              onNotesChange={handleNotes}
              onClear={clear}
              onRetry={runner.retry}
              onInput={runner.provideInput}
              onEndInput={runner.endInput}
              testsPanel={
                <TestCasesPanel
                  // Remounted per pad, so the selected case starts over.
                  key={active.id}
                  tests={getActive().tests}
                  testRun={runner.testRun}
                  status={status}
                  onAdd={handleAddTest}
                  onRemove={handleRemoveTest}
                  onChange={handleChangeTest}
                  onRun={runTestsActive}
                  onStop={stop}
                />
              }
            />
          }
        />
      </div>
      <StatusBar status={status} saveFailed={pads.saveFailed} cursorStore={cursorStore} />
      <CommandPalette open={paletteOpen} commands={commands} onClose={closePalette} />
      {/* Announced to screen readers only: how to reach every action. */}
      <p className="visually-hidden">Press {PALETTE_SHORTCUT_LABEL} to open the command palette.</p>
    </div>
  );
}
