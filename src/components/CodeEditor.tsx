import Editor, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import type { ResolvedTheme } from "../theme/theme";

interface CodeEditorProps {
  padId: string;
  /** Only used the first time a pad is opened; after that Monaco's model owns the text. */
  initialCode: string;
  theme: ResolvedTheme;
  /** Filled in with a function that focuses the editor, for commands that need it. */
  focusRef: MutableRefObject<(() => void) | null>;
  onChange(code: string): void;
  onRun(): void;
  onRunTests(): void;
  onOpenPalette(): void;
  onCursorChange(line: number, column: number): void;
}

const THEMES: Record<ResolvedTheme, string> = { dark: "practicepad-dark", light: "practicepad-light" };

// Keep these in step with --editor-bg and friends in styles.css.
const defineThemes: BeforeMount = (monaco) => {
  monaco.editor.defineTheme(THEMES.dark, {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#0f1218",
      "editor.lineHighlightBackground": "#171b24",
      "editorLineNumber.foreground": "#4b5364",
      "editorLineNumber.activeForeground": "#aab2c3",
      "editorGutter.background": "#0f1218",
      "editorIndentGuide.background1": "#1d222c",
    },
  });
  monaco.editor.defineTheme(THEMES.light, {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#ffffff",
      "editor.lineHighlightBackground": "#f3f5f9",
      "editorLineNumber.foreground": "#a3abb9",
      "editorLineNumber.activeForeground": "#414a5a",
      "editorGutter.background": "#ffffff",
    },
  });
};

// Every prop handed to <Editor> below is kept stable across renders. The wrapper reacts to each
// prop change with Monaco calls (options are re-applied, the change listener is re-registered),
// so a fresh object or function per render would tax Monaco on every re-render of the app.
const OPTIONS: Parameters<typeof Editor>[0]["options"] = {
  fontSize: 14,
  lineHeight: 21,
  fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, Consolas, monospace',
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 4,
  insertSpaces: true,
  renderLineHighlight: "line",
  overviewRulerBorder: false,
  padding: { top: 12, bottom: 12 },
};

const LOADING = <div className="editor-loading">Loading editor…</div>;

export function CodeEditor(props: CodeEditorProps) {
  const { padId, initialCode, theme, focusRef } = props;

  // Monaco keeps these handlers registered from mount, so they reach the latest props through a ref.
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      // Replaces Monaco's default Cmd/Ctrl+Enter ("insert line below") with Run.
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => latest.current.onRun());
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => latest.current.onRunTests());
      // Cmd/Ctrl+K is a chord prefix in Monaco; claim it for the command palette instead.
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => latest.current.onOpenPalette());
      editor.onDidChangeCursorPosition((event) => {
        latest.current.onCursorChange(event.position.lineNumber, event.position.column);
      });
      focusRef.current = () => editor.focus();
      editor.focus();
    },
    [focusRef],
  );

  const handleChange = useCallback((value: string | undefined) => latest.current.onChange(value ?? ""), []);

  // Only read when a pad is first opened, so it need not follow the text typed since.
  const defaultValue = useMemo(() => initialCode, [padId]);

  return (
    <Editor
      height="100%"
      language="python"
      theme={THEMES[theme]}
      // One Monaco model per pad keeps undo history separate between pads.
      path={`${padId}.py`}
      // Deliberately uncontrolled. With a `value` prop the wrapper rewrites the editor whenever
      // React's copy differs, and React's copy lags behind fast typing, so keystrokes got dropped.
      defaultValue={defaultValue}
      onChange={handleChange}
      beforeMount={defineThemes}
      onMount={handleMount}
      loading={LOADING}
      options={OPTIONS}
    />
  );
}
