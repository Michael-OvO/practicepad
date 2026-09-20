# PracticePad

A CoderPad-style interview practice playground that runs **real Python in your browser**.
Write code in a Monaco editor, press Run, and see real output, real tracebacks, and real
package imports, with an interview timer ticking in the corner.

**Live:** https://practicepad-psi.vercel.app

## Quick start

```bash
npm install
npm run dev
```

Open the printed URL. The first load fetches the Python runtime (about 10 MB) from the
jsDelivr CDN; after that it comes from the browser cache.

## What it does

- **Real Python 3.14.** Code runs on [Pyodide](https://pyodide.org) (CPython compiled to
  WebAssembly) inside a Web Worker, so the page never freezes. Each run starts from a clean
  `__main__`, and tracebacks point at `main.py` exactly like `python main.py` would.
- **Real packages.** Just write `import numpy`, `import pandas`, `import scipy`,
  `import sklearn`, `import networkx`, `import sympy`… Packages that ship with Pyodide load
  on first import, and any pure-Python package on PyPI is installed automatically with
  `micropip`. Progress shows up in the output pane.
- **Stop button.** Infinite loop? Stop kills the worker and boots a fresh interpreter in a
  second or two.
- **Interview timer.** 30 / 45 / 60 minute presets or a custom length. Turns amber with five
  minutes left and red when time is up. Survives a page reload.
- **Command palette.** Cmd+K (macOS) or Ctrl+K opens a searchable list of every action: run,
  stop, clear output, new pad, jump to any pad by name, timer controls, themes. Arrow keys and
  Enter to run one; `np` finds "New pad".
- **Familiar interview layout.** Run sits at the top-left of the editor, the right pane has
  Program Output and Notes tabs, and a status bar shows cursor position and runtime state.
- **Notes per pad.** Keep the problem statement, examples, and your approach next to the code.
- **Dark and light themes.** Follows your system by default; toggle from the left rail or the
  palette. Your choice is remembered.
- **Multiple pads, autosaved.** Pads live in `localStorage`. Create, rename, and delete them
  from the pads panel.
- **Shortcuts.** Cmd/Ctrl+Enter runs the current pad. Cmd/Ctrl+K opens the command palette.
- **Interactive stdin.** When your program calls `input()` (or reads `sys.stdin`), a field
  appears in the output where the program is waiting. Enter sends a line; Ctrl+D sends
  end-of-file.
- **Python loads on the first Run**, not when the page opens, so an idle tab stays light.
- **Test cases.** The Test cases tab holds inputs with expected outputs, saved with the pad.
  Run tests (Cmd/Ctrl+Shift+Enter) runs your program once per case with that input as stdin
  and marks each case passed or failed; leave the expectation empty to just see the output.

## Limits

- No threads, subprocesses, or raw sockets (browser sandbox).
- Packages with native code that Pyodide does not ship (for example `torch` or
  `tensorflow`) cannot be installed.
- Roughly 2–5x slower than native CPython for pure-Python loops.
- Needs a network connection the first time each package is imported.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Typecheck and build static files into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Unit tests plus the Pyodide harness integration test (needs network) |
| `npm run test:e2e` | Playwright browser tests (first run `npx playwright install chromium`) |

## Deploying

`npm run build` produces a fully static site with relative asset paths, so `dist/` can be
served from any static host, including a GitHub Pages sub-path. There is no backend.

## How it fits together

- `src/runner/harness.py` makes a run behave like `python main.py`: fresh `__main__`
  module, import resolution, trimmed tracebacks.
- `src/runner/pyodide.worker.ts` hosts Pyodide and streams output through a budgeted
  buffer, so a `while True: print()` loop cannot flood the UI.
- `src/runner/runnerController.ts` is the worker lifecycle state machine
  (loading → ready → running, plus stop and crash recovery).
- `src/pads/padStore.ts` and `src/timer/timer.ts` are pure state modules; the React hooks
  next to them only bind them to the UI.
- `src/pads/padSession.ts` keeps pad state readable synchronously, outside React's render
  cycle, so closing the tab or pressing Run always sees the very last keystroke.
- `src/commands/commandSearch.ts` ranks commands for the palette; `src/App.tsx` builds the
  command list from live app state.
