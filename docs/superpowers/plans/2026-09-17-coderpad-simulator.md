# CoderPad Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static web app ("PracticePad") that simulates the CoderPad interview interface: Monaco editor, real Python execution with real package imports, output console, interview timer, and multiple autosaved pads.

**Architecture:** A Vite + React + TypeScript single-page app. Python runs in a Web Worker hosting Pyodide (CPython 3.14 on WebAssembly) loaded from jsDelivr; a small Python harness makes each run behave like `python main.py`. All state logic (pads, timer, console, output batching, worker lifecycle) lives in pure, unit-tested modules; React hooks and components are thin bindings over them.

**Tech Stack:** Vite, React 19, TypeScript, `@monaco-editor/react`, Pyodide 314.0.7, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-17-coderpad-simulator-design.md`

## Global Constraints

- Pyodide version is exactly `314.0.7` everywhere (npm dev dependency and CDN URL `https://cdn.jsdelivr.net/pyodide/v314.0.7/full/`).
- Python only. No backend. Persistence is `localStorage` only, under keys prefixed `coderpad-sim:`.
- `input()` is unsupported and raises `RuntimeError("input() is not supported in this playground")`.
- Console keeps at most 5,000 lines.
- Timer: presets 30 / 45 / 60 minutes, custom 1–180, default 45; amber at ≤ 5 minutes; "Time's up" at zero.
- The app must build to fully static files (`base: "./"`) so it can be hosted on GitHub Pages.
- No git commits: the directory is not a git repository and the user has not asked for commits.
- Files in this plan are introduced with a line of the form **Write `path`:** followed by one fenced block holding the complete file content.

## File Structure

```
index.html                         page shell
package.json, tsconfig.json, vite.config.ts, playwright.config.ts, .gitignore, README.md
src/
  main.tsx                         React entry
  App.tsx                          composes hooks and components
  styles.css                       all styling (dark theme)
  storage.ts                       safe localStorage access
  platform.ts                      run-shortcut label for the current OS
  runner/
    protocol.ts                    worker message types + Pyodide version/URL
    outputBuffer.ts                budgeted output forwarding (worker side)
    consoleModel.ts                console segments + 5,000-line cap
    harness.py                     import resolution + exec + tracebacks (Python)
    harness.ts                     loads harness.py into Pyodide; runProgram()
    runnerController.ts            worker lifecycle state machine (no React)
    pyodide.worker.ts              the Web Worker
    createPyodideWorker.ts         real WorkerFactory
    usePythonRunner.ts             React binding
  pads/
    padStore.ts                    pure pad CRUD + persistence
    formatUpdated.ts               "5 min ago" labels
    usePads.ts                     React binding + debounced autosave
  timer/
    timer.ts                       pure timer state machine
    useTimer.ts                    React binding + ticking
  components/
    icons.tsx, TitleField.tsx, TopBar.tsx, Timer.tsx, PadSidebar.tsx,
    CodeEditor.tsx, OutputConsole.tsx, SplitPane.tsx
tests/
  harness.integration.test.ts      real Pyodide in Node
e2e/
  smoke.spec.ts                    Playwright, against the production build
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `.gitignore`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/styles.css`

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `preview`, `typecheck`, `test`, `test:e2e`; `App` named export from `src/App.tsx`.

- [ ] **Step 1: Write the config and entry files**

**Write `package.json`:**

```json
{
  "name": "practicepad",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:e2e": "playwright test"
  }
}
```

**Write `tsconfig.json`:**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client", "node"]
  },
  "include": ["src", "tests", "e2e", "vite.config.ts", "playwright.config.ts"]
}
```

**Write `vite.config.ts`:**

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Relative asset URLs so the build works from any sub-path (GitHub Pages).
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
```

**Write `.gitignore`:**

```
node_modules
dist
test-results
playwright-report
*.local
.DS_Store
```

**Write `index.html`:**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link
      rel="icon"
      href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%232fbf71'/%3E%3Cpath d='M9 11l6 5-6 5M17 22h7' fill='none' stroke='%2304210f' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"
    />
    <title>PracticePad</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Write `src/main.tsx`:**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

**Write `src/App.tsx`:**

```tsx
export function App() {
  return <div className="app">PracticePad</div>;
}
```

**Write `src/styles.css`:**

```css
html,
body,
#root {
  height: 100%;
  margin: 0;
}
```

- [ ] **Step 2: Install dependencies**

Run:

```bash
npm install react react-dom @monaco-editor/react
npm install -D vite @vitejs/plugin-react typescript vitest @playwright/test @types/react @types/react-dom @types/node
npm install -D --save-exact pyodide@314.0.7
```

Expected: all three commands exit 0.

- [ ] **Step 3: Verify the scaffold builds**

Run: `npm run build`
Expected: `tsc` reports no errors and Vite writes `dist/index.html`.

---

### Task 2: Pad store

**Files:**
- Create: `src/storage.ts`, `src/pads/padStore.ts`, `src/pads/formatUpdated.ts`
- Test: `src/pads/padStore.test.ts`, `src/pads/formatUpdated.test.ts`

**Interfaces:**
- Produces:
  - `getStorage(): Storage | null`
  - `interface Pad { id: string; title: string; code: string; createdAt: number; updatedAt: number }`
  - `interface PadState { pads: Pad[]; activeId: string }`
  - `PADS_KEY = "coderpad-sim:pads"`, `ACTIVE_PAD_KEY = "coderpad-sim:active-pad"`, `STARTER_CODE: string`
  - `initialState(now?, id?)`, `createPad(state, now?, id?)`, `selectPad(state, id)`, `renamePad(state, id, title, now?)`, `updateCode(state, id, code, now?)`, `deletePad(state, id, now?, replacementId?)` — all return `PadState`
  - `sortedByRecent(pads: Pad[]): Pad[]`, `activePad(state): Pad`
  - `loadState(storage: Pick<Storage, "getItem"> | null, now?, id?): PadState`
  - `saveState(storage: Pick<Storage, "setItem"> | null, state): boolean` (false when nothing was saved)
  - `formatUpdated(updatedAt: number, now: number): string`

- [ ] **Step 1: Write the failing tests**

**Write `src/pads/padStore.test.ts`:**

```ts
import { describe, expect, it } from "vitest";
import {
  ACTIVE_PAD_KEY,
  PADS_KEY,
  STARTER_CODE,
  activePad,
  createPad,
  deletePad,
  initialState,
  loadState,
  renamePad,
  saveState,
  selectPad,
  sortedByRecent,
  updateCode,
} from "./padStore";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe("initialState", () => {
  it("starts with one active pad holding the starter code", () => {
    expect(initialState(1000, "a")).toEqual({
      pads: [{ id: "a", title: "Untitled pad 1", code: STARTER_CODE, createdAt: 1000, updatedAt: 1000 }],
      activeId: "a",
    });
  });
});

describe("createPad", () => {
  it("appends a new pad and makes it active", () => {
    const state = createPad(initialState(1, "a"), 2, "b");
    expect(state.pads.map((pad) => pad.id)).toEqual(["a", "b"]);
    expect(state.activeId).toBe("b");
    expect(activePad(state).title).toBe("Untitled pad 2");
  });

  it("numbers untitled pads after the highest existing number", () => {
    let state = createPad(initialState(1, "a"), 2, "b");
    state = deletePad(state, "a", 3);
    state = createPad(state, 4, "c");
    expect(activePad(state).title).toBe("Untitled pad 3");
  });
});

describe("selectPad", () => {
  it("activates an existing pad", () => {
    const state = createPad(initialState(1, "a"), 2, "b");
    expect(selectPad(state, "a").activeId).toBe("a");
  });

  it("ignores unknown ids", () => {
    const state = initialState(1, "a");
    expect(selectPad(state, "missing")).toBe(state);
  });
});

describe("renamePad", () => {
  it("trims the title and bumps updatedAt", () => {
    const state = renamePad(initialState(1, "a"), "a", "  Two Sum  ", 50);
    expect(activePad(state)).toMatchObject({ title: "Two Sum", updatedAt: 50, createdAt: 1 });
  });

  it("ignores blank titles", () => {
    const state = initialState(1, "a");
    expect(renamePad(state, "a", "   ", 50)).toBe(state);
  });
});

describe("updateCode", () => {
  it("changes only the targeted pad", () => {
    let state = createPad(initialState(1, "a"), 2, "b");
    state = updateCode(state, "a", "print(1)", 99);
    expect(state.pads.find((pad) => pad.id === "a")).toMatchObject({ code: "print(1)", updatedAt: 99 });
    expect(state.pads.find((pad) => pad.id === "b")).toMatchObject({ code: STARTER_CODE, updatedAt: 2 });
  });
});

describe("deletePad", () => {
  it("activates the most recently updated pad when the active one is deleted", () => {
    let state = createPad(initialState(1, "a"), 2, "b");
    state = createPad(state, 3, "c");
    state = updateCode(state, "a", "x = 1", 10);
    state = deletePad(state, "c", 11);
    expect(state.pads.map((pad) => pad.id)).toEqual(["a", "b"]);
    expect(state.activeId).toBe("a");
  });

  it("keeps the active pad when another pad is deleted", () => {
    const state = deletePad(createPad(initialState(1, "a"), 2, "b"), "a", 3);
    expect(state.activeId).toBe("b");
  });

  it("creates a fresh pad when the last one is deleted", () => {
    const state = deletePad(initialState(1, "a"), "a", 7, "fresh");
    expect(state).toEqual(initialState(7, "fresh"));
  });

  it("ignores unknown ids", () => {
    const state = initialState(1, "a");
    expect(deletePad(state, "missing", 2)).toBe(state);
  });
});

describe("sortedByRecent", () => {
  it("orders pads by updatedAt, newest first, without mutating the input", () => {
    const state = updateCode(createPad(initialState(1, "a"), 2, "b"), "a", "x", 5);
    expect(sortedByRecent(state.pads).map((pad) => pad.id)).toEqual(["a", "b"]);
    expect(state.pads.map((pad) => pad.id)).toEqual(["a", "b"]);
  });
});

describe("persistence", () => {
  it("round-trips through storage", () => {
    const storage = fakeStorage();
    const state = selectPad(createPad(initialState(1, "a"), 2, "b"), "a");
    expect(saveState(storage, state)).toBe(true);
    expect(loadState(storage, 100, "unused")).toEqual(state);
  });

  it("falls back to a fresh pad when storage is empty, corrupt, or not an array", () => {
    expect(loadState(fakeStorage(), 5, "n")).toEqual(initialState(5, "n"));
    expect(loadState(fakeStorage({ [PADS_KEY]: "{not json" }), 5, "n")).toEqual(initialState(5, "n"));
    expect(loadState(fakeStorage({ [PADS_KEY]: '{"pads":1}' }), 5, "n")).toEqual(initialState(5, "n"));
  });

  it("drops malformed pads and repairs a stale active id", () => {
    const good = { id: "g", title: "Good", code: "pass", createdAt: 1, updatedAt: 2 };
    const storage = fakeStorage({
      [PADS_KEY]: JSON.stringify([good, { id: 7, title: "bad" }, null]),
      [ACTIVE_PAD_KEY]: "gone",
    });
    expect(loadState(storage, 5, "n")).toEqual({ pads: [good], activeId: "g" });
  });

  it("reports failure when storage is unavailable or full", () => {
    const state = initialState(1, "a");
    expect(saveState(null, state)).toBe(false);
    const full = {
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(saveState(full, state)).toBe(false);
    expect(loadState(null, 5, "n")).toEqual(initialState(5, "n"));
  });
});
```

**Write `src/pads/formatUpdated.test.ts`:**

```ts
import { describe, expect, it } from "vitest";
import { formatUpdated } from "./formatUpdated";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatUpdated", () => {
  const now = Date.UTC(2026, 8, 17, 12, 0, 0);

  it("uses coarse relative labels for recent edits", () => {
    expect(formatUpdated(now - 20_000, now)).toBe("just now");
    expect(formatUpdated(now - 5 * MINUTE, now)).toBe("5 min ago");
    expect(formatUpdated(now - 3 * HOUR, now)).toBe("3 h ago");
    expect(formatUpdated(now - 2 * DAY, now)).toBe("2 d ago");
  });

  it("falls back to a calendar date after a week", () => {
    expect(formatUpdated(now - 30 * DAY, now)).toMatch(/\d/);
    expect(formatUpdated(now - 30 * DAY, now)).not.toContain("ago");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/pads`
Expected: FAIL — both files error with "Failed to resolve import" for `./padStore` / `./formatUpdated`.

- [ ] **Step 3: Write the implementation**

**Write `src/storage.ts`:**

```ts
/** localStorage, or null when the browser blocks it (private mode, disabled site data). */
export function getStorage(): Storage | null {
  try {
    const storage = window.localStorage;
    storage.getItem("coderpad-sim:probe");
    return storage;
  } catch {
    return null;
  }
}
```

**Write `src/pads/padStore.ts`:**

```ts
export interface Pad {
  id: string;
  title: string;
  code: string;
  createdAt: number;
  updatedAt: number;
}

export interface PadState {
  pads: Pad[];
  activeId: string;
}

export const PADS_KEY = "coderpad-sim:pads";
export const ACTIVE_PAD_KEY = "coderpad-sim:active-pad";

export const STARTER_CODE = `# Welcome to PracticePad.
# Real Python 3.14 runs right here in your browser. Packages such as numpy
# and pandas are fetched automatically the first time you import them.


def say_hello():
    print("Hello, World!")


for _ in range(3):
    say_hello()
`;

function nextUntitledTitle(pads: Pad[]): string {
  let highest = 0;
  for (const pad of pads) {
    const match = /^Untitled pad (\d+)$/.exec(pad.title);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `Untitled pad ${highest + 1}`;
}

function newPad(existing: Pad[], now: number, id: string): Pad {
  return { id, title: nextUntitledTitle(existing), code: STARTER_CODE, createdAt: now, updatedAt: now };
}

export function initialState(now: number = Date.now(), id: string = crypto.randomUUID()): PadState {
  const pad = newPad([], now, id);
  return { pads: [pad], activeId: pad.id };
}

export function createPad(state: PadState, now: number = Date.now(), id: string = crypto.randomUUID()): PadState {
  const pad = newPad(state.pads, now, id);
  return { pads: [...state.pads, pad], activeId: pad.id };
}

export function selectPad(state: PadState, id: string): PadState {
  return state.pads.some((pad) => pad.id === id) ? { ...state, activeId: id } : state;
}

function patchPad(state: PadState, id: string, patch: Partial<Pad>, now: number): PadState {
  return {
    ...state,
    pads: state.pads.map((pad) => (pad.id === id ? { ...pad, ...patch, updatedAt: now } : pad)),
  };
}

export function renamePad(state: PadState, id: string, title: string, now: number = Date.now()): PadState {
  const trimmed = title.trim();
  return trimmed === "" ? state : patchPad(state, id, { title: trimmed }, now);
}

export function updateCode(state: PadState, id: string, code: string, now: number = Date.now()): PadState {
  return patchPad(state, id, { code }, now);
}

export function sortedByRecent(pads: Pad[]): Pad[] {
  return [...pads].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deletePad(
  state: PadState,
  id: string,
  now: number = Date.now(),
  replacementId: string = crypto.randomUUID(),
): PadState {
  const pads = state.pads.filter((pad) => pad.id !== id);
  if (pads.length === state.pads.length) return state;
  // There is always at least one pad to edit.
  if (pads.length === 0) return initialState(now, replacementId);
  const activeId = state.activeId === id ? sortedByRecent(pads)[0].id : state.activeId;
  return { pads, activeId };
}

export function activePad(state: PadState): Pad {
  return state.pads.find((pad) => pad.id === state.activeId) ?? state.pads[0];
}

function isPad(value: unknown): value is Pad {
  if (typeof value !== "object" || value === null) return false;
  const pad = value as Record<string, unknown>;
  return (
    typeof pad.id === "string" &&
    typeof pad.title === "string" &&
    typeof pad.code === "string" &&
    typeof pad.createdAt === "number" &&
    typeof pad.updatedAt === "number"
  );
}

export function loadState(
  storage: Pick<Storage, "getItem"> | null,
  now: number = Date.now(),
  id: string = crypto.randomUUID(),
): PadState {
  if (!storage) return initialState(now, id);
  try {
    const parsed: unknown = JSON.parse(storage.getItem(PADS_KEY) ?? "null");
    const pads = Array.isArray(parsed) ? parsed.filter(isPad) : [];
    if (pads.length === 0) return initialState(now, id);
    const saved = storage.getItem(ACTIVE_PAD_KEY);
    const activeId = pads.find((pad) => pad.id === saved)?.id ?? sortedByRecent(pads)[0].id;
    return { pads, activeId };
  } catch {
    return initialState(now, id);
  }
}

/** Returns false when nothing could be saved (storage blocked or over quota). */
export function saveState(storage: Pick<Storage, "setItem"> | null, state: PadState): boolean {
  if (!storage) return false;
  try {
    storage.setItem(PADS_KEY, JSON.stringify(state.pads));
    storage.setItem(ACTIVE_PAD_KEY, state.activeId);
    return true;
  } catch {
    return false;
  }
}
```

**Write `src/pads/formatUpdated.ts`:**

```ts
/** Coarse "last edited" label for the pad list. */
export function formatUpdated(updatedAt: number, now: number): string {
  const minutes = Math.floor((now - updatedAt) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/pads`
Expected: PASS — 2 files, all tests green.

---

### Task 3: Timer state machine

**Files:**
- Create: `src/timer/timer.ts`
- Test: `src/timer/timer.test.ts`

**Interfaces:**
- Produces:
  - `type TimerState = { status: "idle"; durationMs } | { status: "running"; durationMs; endsAt } | { status: "paused"; durationMs; remainingMs }`
  - `type TimerPhase = "normal" | "warning" | "expired"`
  - `TIMER_KEY = "coderpad-sim:timer"`, `PRESET_MINUTES = [30, 45, 60]`, `DEFAULT_MINUTES = 45`, `MIN_MINUTES = 1`, `MAX_MINUTES = 180`
  - `idleTimer(minutes?)`, `clampMinutes(minutes)`, `start(state, now)`, `pause(state, now)`, `resume(state, now)`, `reset(state)`, `setDuration(state, minutes)`
  - `remainingMs(state, now): number`, `timerPhase(state, now): TimerPhase`, `formatRemaining(ms): string`, `parseTimer(raw: string | null): TimerState`

- [ ] **Step 1: Write the failing test**

**Write `src/timer/timer.test.ts`:**

```ts
import { describe, expect, it } from "vitest";
import {
  clampMinutes,
  formatRemaining,
  idleTimer,
  parseTimer,
  pause,
  remainingMs,
  reset,
  resume,
  setDuration,
  start,
  timerPhase,
} from "./timer";

const MINUTE = 60_000;

describe("transitions", () => {
  it("defaults to an idle 45 minute timer", () => {
    expect(idleTimer()).toEqual({ status: "idle", durationMs: 45 * MINUTE });
  });

  it("starts from idle by fixing the end time", () => {
    expect(start(idleTimer(30), 1_000)).toEqual({ status: "running", durationMs: 30 * MINUTE, endsAt: 1_000 + 30 * MINUTE });
  });

  it("pauses with the time that was left and resumes from it", () => {
    const running = start(idleTimer(30), 0);
    const paused = pause(running, 10 * MINUTE);
    expect(paused).toEqual({ status: "paused", durationMs: 30 * MINUTE, remainingMs: 20 * MINUTE });
    expect(resume(paused, 99 * MINUTE)).toEqual({ status: "running", durationMs: 30 * MINUTE, endsAt: 119 * MINUTE });
  });

  it("resets to idle with the same duration", () => {
    expect(reset(start(idleTimer(60), 0))).toEqual(idleTimer(60));
  });

  it("ignores transitions that do not apply to the current status", () => {
    const idle = idleTimer();
    const running = start(idle, 0);
    expect(pause(idle, 5)).toBe(idle);
    expect(resume(idle, 5)).toBe(idle);
    expect(start(running, 5)).toBe(running);
    expect(setDuration(running, 30)).toBe(running);
  });

  it("changes duration only while idle, clamped to 1-180 whole minutes", () => {
    expect(setDuration(idleTimer(), 20)).toEqual(idleTimer(20));
    expect(clampMinutes(0)).toBe(1);
    expect(clampMinutes(500)).toBe(180);
    expect(clampMinutes(12.6)).toBe(13);
    expect(clampMinutes(Number.NaN)).toBe(45);
  });
});

describe("remainingMs", () => {
  it("counts down while running and never goes negative", () => {
    const running = start(idleTimer(1), 0);
    expect(remainingMs(running, 15_000)).toBe(45_000);
    expect(remainingMs(running, 10 * MINUTE)).toBe(0);
  });

  it("is the full duration when idle and frozen when paused", () => {
    expect(remainingMs(idleTimer(30), 123)).toBe(30 * MINUTE);
    expect(remainingMs(pause(start(idleTimer(30), 0), MINUTE), 50 * MINUTE)).toBe(29 * MINUTE);
  });

  it("survives a reload because a running timer stores its end time", () => {
    const restored = parseTimer(JSON.stringify(start(idleTimer(30), 0)));
    expect(remainingMs(restored, 12 * MINUTE)).toBe(18 * MINUTE);
  });
});

describe("timerPhase", () => {
  it("warns in the last five minutes and expires at zero", () => {
    const running = start(idleTimer(30), 0);
    expect(timerPhase(running, 0)).toBe("normal");
    expect(timerPhase(running, 25 * MINUTE)).toBe("warning");
    expect(timerPhase(running, 30 * MINUTE)).toBe("expired");
  });

  it("stays normal while idle, even for short durations", () => {
    expect(timerPhase(idleTimer(3), 0)).toBe("normal");
  });
});

describe("formatRemaining", () => {
  it("renders MM:SS, rounding partial seconds up", () => {
    expect(formatRemaining(45 * MINUTE)).toBe("45:00");
    expect(formatRemaining(45 * MINUTE - 1)).toBe("45:00");
    expect(formatRemaining(61_000)).toBe("01:01");
    expect(formatRemaining(0)).toBe("00:00");
    expect(formatRemaining(180 * MINUTE)).toBe("180:00");
  });
});

describe("parseTimer", () => {
  it("falls back to the default for missing or malformed data", () => {
    expect(parseTimer(null)).toEqual(idleTimer());
    expect(parseTimer("{oops")).toEqual(idleTimer());
    expect(parseTimer('{"status":"running","durationMs":"x"}')).toEqual(idleTimer());
    expect(parseTimer('{"status":"flying","durationMs":1000}')).toEqual(idleTimer());
  });

  it("accepts each valid shape", () => {
    const paused = pause(start(idleTimer(30), 0), MINUTE);
    expect(parseTimer(JSON.stringify(paused))).toEqual(paused);
    expect(parseTimer(JSON.stringify(idleTimer(60)))).toEqual(idleTimer(60));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/timer`
Expected: FAIL — "Failed to resolve import" for `./timer`.

- [ ] **Step 3: Write the implementation**

**Write `src/timer/timer.ts`:**

```ts
export type TimerState =
  | { status: "idle"; durationMs: number }
  | { status: "running"; durationMs: number; endsAt: number }
  | { status: "paused"; durationMs: number; remainingMs: number };

export type TimerPhase = "normal" | "warning" | "expired";

export const TIMER_KEY = "coderpad-sim:timer";
export const PRESET_MINUTES: readonly number[] = [30, 45, 60];
export const DEFAULT_MINUTES = 45;
export const MIN_MINUTES = 1;
export const MAX_MINUTES = 180;

const MINUTE_MS = 60_000;
const WARNING_MS = 5 * MINUTE_MS;

export function clampMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return DEFAULT_MINUTES;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(minutes)));
}

export function idleTimer(minutes: number = DEFAULT_MINUTES): TimerState {
  return { status: "idle", durationMs: clampMinutes(minutes) * MINUTE_MS };
}

export function remainingMs(state: TimerState, now: number): number {
  switch (state.status) {
    case "idle":
      return state.durationMs;
    case "paused":
      return state.remainingMs;
    case "running":
      return Math.max(0, state.endsAt - now);
  }
}

export function start(state: TimerState, now: number): TimerState {
  if (state.status !== "idle") return state;
  return { status: "running", durationMs: state.durationMs, endsAt: now + state.durationMs };
}

export function pause(state: TimerState, now: number): TimerState {
  if (state.status !== "running") return state;
  return { status: "paused", durationMs: state.durationMs, remainingMs: remainingMs(state, now) };
}

export function resume(state: TimerState, now: number): TimerState {
  if (state.status !== "paused") return state;
  return { status: "running", durationMs: state.durationMs, endsAt: now + state.remainingMs };
}

export function reset(state: TimerState): TimerState {
  return { status: "idle", durationMs: state.durationMs };
}

export function setDuration(state: TimerState, minutes: number): TimerState {
  return state.status === "idle" ? idleTimer(minutes) : state;
}

export function timerPhase(state: TimerState, now: number): TimerPhase {
  if (state.status === "idle") return "normal";
  const left = remainingMs(state, now);
  if (left === 0) return "expired";
  return left <= WARNING_MS ? "warning" : "normal";
}

export function formatRemaining(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function parseTimer(raw: string | null): TimerState {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (typeof value !== "object" || value === null) return idleTimer();
    const timer = value as Record<string, unknown>;
    if (typeof timer.durationMs !== "number") return idleTimer();
    if (timer.status === "idle") return { status: "idle", durationMs: timer.durationMs };
    if (timer.status === "running" && typeof timer.endsAt === "number") {
      return { status: "running", durationMs: timer.durationMs, endsAt: timer.endsAt };
    }
    if (timer.status === "paused" && typeof timer.remainingMs === "number") {
      return { status: "paused", durationMs: timer.durationMs, remainingMs: timer.remainingMs };
    }
    return idleTimer();
  } catch {
    return idleTimer();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/timer`
Expected: PASS.

---

### Task 4: Protocol, output buffer, console model

**Files:**
- Create: `src/runner/protocol.ts`, `src/runner/outputBuffer.ts`, `src/runner/consoleModel.ts`
- Test: `src/runner/outputBuffer.test.ts`, `src/runner/consoleModel.test.ts`

**Interfaces:**
- Produces:
  - `PYODIDE_VERSION = "314.0.7"`, `PYODIDE_INDEX_URL`
  - `type OutputStream = "stdout" | "stderr"`, `interface OutputChunk { stream: OutputStream; text: string }`
  - `type WorkerRequest = { type: "run"; runId: number; code: string }`
  - `type WorkerResponse` = `ready` | `status {runId, message}` | `output {runId, chunks}` | `done {runId, exitCode, durationMs}` | `crashed {runId, message}` | `fatal {message}`
  - `class OutputBuffer { constructor(emit: (chunks: OutputChunk[]) => void, options?: OutputBufferOptions); write(stream, text): void; flush(): void }`
  - `type ConsoleKind = "stdout" | "stderr" | "system"`, `interface ConsoleSegment { id: number; kind: ConsoleKind; text: string }`, `interface ConsoleState { segments; lineCount; truncated; nextId }`
  - `emptyConsole: ConsoleState`, `MAX_CONSOLE_LINES = 5000`, `appendText(state, kind, text, maxLines?): ConsoleState`

- [ ] **Step 1: Write the protocol types and the failing tests**

**Write `src/runner/protocol.ts`:**

```ts
/** Must match the `pyodide` dev dependency, which the Node integration test runs against. */
export const PYODIDE_VERSION = "314.0.7";
export const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

export type OutputStream = "stdout" | "stderr";

export interface OutputChunk {
  stream: OutputStream;
  text: string;
}

export type WorkerRequest = { type: "run"; runId: number; code: string };

export type WorkerResponse =
  | { type: "ready" }
  | { type: "status"; runId: number; message: string }
  | { type: "output"; runId: number; chunks: OutputChunk[] }
  | { type: "done"; runId: number; exitCode: number; durationMs: number }
  | { type: "crashed"; runId: number; message: string }
  | { type: "fatal"; message: string };
```

**Write `src/runner/outputBuffer.test.ts`:**

```ts
import { describe, expect, it } from "vitest";
import { OutputBuffer } from "./outputBuffer";
import type { OutputChunk } from "./protocol";

function setup(options: { immediatePerWindow?: number; maxBufferedChars?: number } = {}) {
  const emitted: OutputChunk[][] = [];
  const clock = { now: 0 };
  const buffer = new OutputBuffer((chunks) => emitted.push(chunks), {
    now: () => clock.now,
    windowMs: 50,
    immediatePerWindow: options.immediatePerWindow ?? 2,
    maxBufferedChars: options.maxBufferedChars ?? 1000,
  });
  return { buffer, emitted, clock };
}

describe("OutputBuffer", () => {
  it("forwards writes immediately while under the per-window budget", () => {
    const { buffer, emitted } = setup();
    buffer.write("stdout", "a\n");
    buffer.write("stderr", "b\n");
    expect(emitted).toEqual([[{ stream: "stdout", text: "a\n" }], [{ stream: "stderr", text: "b\n" }]]);
  });

  it("coalesces writes beyond the budget until the window rolls over", () => {
    const { buffer, emitted, clock } = setup();
    buffer.write("stdout", "1");
    buffer.write("stdout", "2");
    buffer.write("stdout", "3");
    buffer.write("stdout", "4");
    buffer.write("stderr", "E");
    expect(emitted).toHaveLength(2);

    clock.now = 60;
    buffer.write("stdout", "5");
    expect(emitted).toHaveLength(3);
    expect(emitted[2]).toEqual([
      { stream: "stdout", text: "34" },
      { stream: "stderr", text: "E" },
      { stream: "stdout", text: "5" },
    ]);
  });

  it("flushes early once the buffered size limit is reached", () => {
    const { buffer, emitted } = setup({ immediatePerWindow: 0, maxBufferedChars: 5 });
    buffer.write("stdout", "abc");
    expect(emitted).toHaveLength(0);
    buffer.write("stdout", "def");
    expect(emitted).toEqual([[{ stream: "stdout", text: "abcdef" }]]);
  });

  it("flush() sends whatever is pending and is a no-op when empty", () => {
    const { buffer, emitted } = setup({ immediatePerWindow: 0 });
    buffer.flush();
    expect(emitted).toHaveLength(0);
    buffer.write("stdout", "tail");
    buffer.flush();
    buffer.flush();
    expect(emitted).toEqual([[{ stream: "stdout", text: "tail" }]]);
  });

  it("ignores empty writes", () => {
    const { buffer, emitted } = setup();
    buffer.write("stdout", "");
    buffer.flush();
    expect(emitted).toHaveLength(0);
  });
});
```

**Write `src/runner/consoleModel.test.ts`:**

```ts
import { describe, expect, it } from "vitest";
import { appendText, emptyConsole, type ConsoleState } from "./consoleModel";

const text = (state: ConsoleState) => state.segments.map((segment) => segment.text).join("");

describe("appendText", () => {
  it("merges consecutive text of the same kind into one segment", () => {
    const state = appendText(appendText(emptyConsole, "stdout", "a\n"), "stdout", "b\n");
    expect(state.segments).toEqual([{ id: 1, kind: "stdout", text: "a\nb\n" }]);
    expect(state.lineCount).toBe(2);
  });

  it("starts a new segment when the kind changes", () => {
    let state = appendText(emptyConsole, "stdout", "out\n");
    state = appendText(state, "stderr", "err\n");
    state = appendText(state, "stdout", "out again\n");
    expect(state.segments.map((segment) => [segment.id, segment.kind])).toEqual([
      [1, "stdout"],
      [2, "stderr"],
      [3, "stdout"],
    ]);
  });

  it("starts a new segment once the last one is large, so updates stay cheap", () => {
    let state = appendText(emptyConsole, "stdout", "x".repeat(5000));
    state = appendText(state, "stdout", "y");
    expect(state.segments).toHaveLength(2);
  });

  it("returns the same state for empty text", () => {
    expect(appendText(emptyConsole, "stdout", "")).toBe(emptyConsole);
  });

  it("drops the oldest lines beyond the cap and flags truncation", () => {
    let state = emptyConsole;
    for (const line of ["1\n", "2\n", "3\n"]) state = appendText(state, "stdout", line, 3);
    expect(state.truncated).toBe(false);
    state = appendText(state, "stderr", "4\n5\n", 3);
    expect(text(state)).toBe("3\n4\n5\n");
    expect(state.lineCount).toBe(3);
    expect(state.truncated).toBe(true);
  });

  it("trims inside a single oversized write", () => {
    const state = appendText(emptyConsole, "stdout", "1\n2\n3\n4\n5\ntail", 2);
    expect(text(state)).toBe("4\n5\ntail");
    expect(state.lineCount).toBe(2);
    expect(state.truncated).toBe(true);
  });

  it("drops whole leading segments before trimming inside the next one", () => {
    let state = appendText(emptyConsole, "system", "note\n", 3);
    state = appendText(state, "stdout", "1\n2\n3\n4\n", 3);
    expect(state.segments).toEqual([{ id: 2, kind: "stdout", text: "2\n3\n4\n" }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/runner`
Expected: FAIL — "Failed to resolve import" for `./outputBuffer` and `./consoleModel`.

- [ ] **Step 3: Write the implementations**

**Write `src/runner/outputBuffer.ts`:**

```ts
import type { OutputChunk, OutputStream } from "./protocol";

export interface OutputBufferOptions {
  now?: () => number;
  windowMs?: number;
  immediatePerWindow?: number;
  maxBufferedChars?: number;
}

/**
 * Forwards program output from the worker without flooding the main thread.
 *
 * Python blocks the worker's event loop while it runs, so timers cannot be used to batch:
 * every decision happens inside write(). Writes go out immediately while the current time
 * window still has budget, which keeps ordinary programs live even when a long computation
 * follows a print. Past the budget, writes are coalesced until the window rolls over, the
 * buffer grows large, or flush() is called at the end of the run.
 */
export class OutputBuffer {
  private readonly emit: (chunks: OutputChunk[]) => void;
  private readonly now: () => number;
  private readonly windowMs: number;
  private readonly immediatePerWindow: number;
  private readonly maxBufferedChars: number;
  private pending: OutputChunk[] = [];
  private pendingChars = 0;
  private windowStart = Number.NEGATIVE_INFINITY;
  private sentInWindow = 0;

  constructor(emit: (chunks: OutputChunk[]) => void, options: OutputBufferOptions = {}) {
    this.emit = emit;
    this.now = options.now ?? (() => performance.now());
    this.windowMs = options.windowMs ?? 50;
    this.immediatePerWindow = options.immediatePerWindow ?? 100;
    this.maxBufferedChars = options.maxBufferedChars ?? 64 * 1024;
  }

  write(stream: OutputStream, text: string): void {
    if (text === "") return;
    const now = this.now();
    if (now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.sentInWindow = 0;
    }
    const last = this.pending[this.pending.length - 1];
    if (last && last.stream === stream) last.text += text;
    else this.pending.push({ stream, text });
    this.pendingChars += text.length;
    if (this.sentInWindow < this.immediatePerWindow || this.pendingChars >= this.maxBufferedChars) {
      this.flush();
    }
  }

  flush(): void {
    if (this.pending.length === 0) return;
    const chunks = this.pending;
    this.pending = [];
    this.pendingChars = 0;
    this.sentInWindow += 1;
    this.emit(chunks);
  }
}
```

**Write `src/runner/consoleModel.ts`:**

```ts
export type ConsoleKind = "stdout" | "stderr" | "system";

export interface ConsoleSegment {
  id: number;
  kind: ConsoleKind;
  text: string;
}

export interface ConsoleState {
  segments: ConsoleSegment[];
  lineCount: number;
  truncated: boolean;
  nextId: number;
}

export const MAX_CONSOLE_LINES = 5000;

// Once a segment is this large, further output starts a new one so each React update
// rewrites a small text node instead of the whole console.
const SEGMENT_TARGET_CHARS = 4096;

export const emptyConsole: ConsoleState = { segments: [], lineCount: 0, truncated: false, nextId: 1 };

function countNewlines(text: string): number {
  let count = 0;
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) count += 1;
  return count;
}

function dropLeadingLines(text: string, lines: number): string {
  let cut = -1;
  for (let remaining = lines; remaining > 0; remaining -= 1) cut = text.indexOf("\n", cut + 1);
  return text.slice(cut + 1);
}

export function appendText(
  state: ConsoleState,
  kind: ConsoleKind,
  text: string,
  maxLines: number = MAX_CONSOLE_LINES,
): ConsoleState {
  if (text === "") return state;
  const segments = [...state.segments];
  let { nextId, truncated } = state;

  const last = segments[segments.length - 1];
  if (last && last.kind === kind && last.text.length < SEGMENT_TARGET_CHARS) {
    segments[segments.length - 1] = { ...last, text: last.text + text };
  } else {
    segments.push({ id: nextId, kind, text });
    nextId += 1;
  }

  let lineCount = state.lineCount + countNewlines(text);
  let excess = lineCount - maxLines;
  while (excess > 0) {
    truncated = true;
    const first = segments[0];
    const lines = countNewlines(first.text);
    if (lines <= excess) {
      segments.shift();
      excess -= lines;
      lineCount -= lines;
    } else {
      segments[0] = { ...first, text: dropLeadingLines(first.text, excess) };
      lineCount -= excess;
      excess = 0;
    }
  }

  return { segments, lineCount, truncated, nextId };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/runner`
Expected: PASS — 2 files, all tests green.

---

### Task 5: Python harness

**Files:**
- Create: `src/runner/harness.py`, `src/runner/harness.ts`
- Test: `tests/harness.integration.test.ts`

**Interfaces:**
- Consumes: `PYODIDE_VERSION` from `src/runner/protocol.ts`.
- Produces:
  - `interface Harness { findMissingImports(code: string): string[]; installMissing(names: string[], report: (message: string) => void): Promise<void>; runMain(code: string): number }`
  - `loadHarness(pyodide: PyodideInterface): Harness`
  - `runProgram(pyodide: PyodideInterface, harness: Harness, code: string, report: (message: string) => void): Promise<number>` — resolves imports, runs the code, returns the exit code.

Background for the implementer: Pyodide is CPython compiled to WebAssembly. The `pyodide` npm package runs in Node too, which is how this task tests the harness without a browser. Packages that ship with Pyodide (numpy, pandas, …) load with `pyodide.loadPackagesFromImports(code)`; anything else pure-Python installs from PyPI with the `micropip` package. `loadPackage` prints progress to the program's stdout unless given a `messageCallback`, so always pass one.

- [ ] **Step 1: Write the failing integration test**

**Write `tests/harness.integration.test.ts`:**

```ts
import { loadPyodide, type PyodideInterface } from "pyodide";
import { beforeAll, describe, expect, it } from "vitest";
import { loadHarness, runProgram, type Harness } from "../src/runner/harness";
import { PYODIDE_VERSION } from "../src/runner/protocol";

let pyodide: PyodideInterface;
let harness: Harness;
let stdout = "";
let stderr = "";

function capture(sink: (text: string) => void) {
  const decoder = new TextDecoder();
  return {
    isatty: false,
    write(bytes: Uint8Array) {
      sink(decoder.decode(bytes, { stream: true }));
      return bytes.length;
    },
  };
}

async function run(code: string) {
  stdout = "";
  stderr = "";
  const statuses: string[] = [];
  const exitCode = await runProgram(pyodide, harness, code, (message) => statuses.push(message));
  return { exitCode, stdout, stderr, statuses };
}

beforeAll(async () => {
  pyodide = await loadPyodide();
  pyodide.setStdout(capture((text) => (stdout += text)));
  pyodide.setStderr(capture((text) => (stderr += text)));
  harness = loadHarness(pyodide);
});

describe("python harness", () => {
  it("runs against the Pyodide version the app loads from the CDN", () => {
    expect(pyodide.version).toBe(PYODIDE_VERSION);
  });

  it("captures stdout, including a final line without a newline", async () => {
    const result = await run('print("hello")\nprint("partial", end="")');
    expect(result).toMatchObject({ exitCode: 0, stdout: "hello\npartial", stderr: "" });
  });

  it("runs as __main__ with a fresh namespace every time", async () => {
    await run("leak = 42");
    const result = await run('if __name__ == "__main__":\n    print("leak" in globals())');
    expect(result.stdout).toBe("False\n");
  });

  it("prints tracebacks that start at main.py", async () => {
    const result = await run("def f(x):\n    return 1 / x\n\nf(0)");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Traceback (most recent call last):\n  File "main.py", line 4, in <module>\n    f(0)');
    expect(result.stderr).toContain('  File "main.py", line 2, in f\n    return 1 / x');
    expect(result.stderr).toContain("ZeroDivisionError: division by zero");
    expect(result.stderr).not.toContain("harness.py");
  });

  it("reports syntax errors the way the python command does", async () => {
    const result = await run('x = (1,\nprint("hi"');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^ {2}File "main\.py", line 2\n/);
    expect(result.stderr).toContain("SyntaxError: '(' was never closed");
    expect(result.stderr).not.toContain("Traceback");
  });

  it("honours sys.exit", async () => {
    expect(await run('import sys\nprint("before")\nsys.exit(3)')).toMatchObject({ exitCode: 3, stdout: "before\n", stderr: "" });
    expect(await run('import sys\nsys.exit("fatal: nope")')).toMatchObject({ exitCode: 1, stderr: "fatal: nope\n" });
  });

  it("lets unittest.main() discover tests defined in the pad", async () => {
    const result = await run(
      [
        "import unittest",
        "",
        "class T(unittest.TestCase):",
        "    def test_ok(self):",
        "        self.assertEqual(1 + 1, 2)",
        "    def test_bad(self):",
        "        self.assertEqual(1, 2)",
        "",
        "unittest.main()",
      ].join("\n"),
    );
    expect(result.stderr).toContain("Ran 2 tests");
    expect(result.stderr).toContain("FAILED (failures=1)");
    expect(result.exitCode).toBe(1);
  });

  it("recovers when a previous run replaced sys.stdout", async () => {
    await run("import sys, io\nsys.stdout = io.StringIO()\nprint('swallowed')");
    expect((await run("print('visible')")).stdout).toBe("visible\n");
  });

  it("rejects input() with a clear message", async () => {
    const result = await run('name = input("name? ")');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("RuntimeError: input() is not supported in this playground");
  });

  it("finds imports that are not installed, ignoring relative imports and broken code", () => {
    expect(harness.findMissingImports("import os, json\nfrom collections import deque")).toEqual([]);
    expect(harness.findMissingImports("import zzz_missing.sub\nfrom . import sibling\nfrom yyy_missing import x")).toEqual([
      "yyy_missing",
      "zzz_missing",
    ]);
    expect(harness.findMissingImports("import (")).toEqual([]);
  });

  it("loads packages bundled with Pyodide on first import", async () => {
    const result = await run("import numpy as np\nprint(np.arange(6).reshape(2, 3).sum(axis=0))");
    expect(result.statuses).toContain("Loading numpy…");
    expect(result).toMatchObject({ exitCode: 0, stdout: "[3 5 7]\n", stderr: "" });
  });

  it("installs pure-Python packages from PyPI without leaking loader logs into stdout", async () => {
    const result = await run('import cowsay\ncowsay.cow("moo")');
    expect(result.statuses).toContain("Installing cowsay from PyPI…");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("| moo |");
    expect(result.stdout).not.toContain("micropip");
  });

  it("still runs the program when a package cannot be installed", async () => {
    const result = await run("import definitely_not_a_real_pkg_xyz");
    expect(result.statuses.some((message) => message.startsWith("Could not install definitely_not_a_real_pkg_xyz"))).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("ModuleNotFoundError: No module named 'definitely_not_a_real_pkg_xyz'");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/harness.integration.test.ts`
Expected: FAIL — "Failed to resolve import" for `../src/runner/harness`.

- [ ] **Step 3: Write the harness**

**Write `src/runner/harness.py`:**

```python
"""Runs user code the way `python main.py` would, inside Pyodide."""

import ast
import builtins
import importlib
import importlib.util
import linecache
import os
import sys
import traceback
import types

HOME = "/home/pyodide"
MAIN_NAME = "main.py"
DEFAULT_RECURSION_LIMIT = sys.getrecursionlimit()

# Import names whose PyPI package name differs.
PACKAGE_ALIASES = {
    "attr": "attrs",
    "bs4": "beautifulsoup4",
    "cv2": "opencv-python",
    "dateutil": "python-dateutil",
    "PIL": "pillow",
    "sklearn": "scikit-learn",
    "yaml": "pyyaml",
}


def _blocked_input(prompt=""):
    raise RuntimeError("input() is not supported in this playground")


def find_missing_imports(code):
    """Top-level module names imported by `code` that are not importable yet."""
    try:
        tree = ast.parse(code)
    except (SyntaxError, ValueError):
        return []
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names.add(node.module.split(".")[0])
    missing = []
    for name in sorted(names):
        try:
            found = importlib.util.find_spec(name) is not None
        except (ImportError, ValueError):
            found = False
        if not found:
            missing.append(name)
    return missing


async def install_missing(names, report):
    """micropip-install each missing import, reporting progress through `report`."""
    import micropip

    for name in names:
        package = PACKAGE_ALIASES.get(name, name)
        report(f"Installing {package} from PyPI…")
        try:
            await micropip.install(package)
        except Exception as exc:
            lines = str(exc).strip().splitlines()
            report(f"Could not install {package}: {lines[0] if lines else type(exc).__name__}")
    importlib.invalidate_caches()


def run_main(code):
    """Execute `code` as a fresh __main__ module and return the exit code."""
    # Undo anything a previous run may have left behind, as a new process would.
    sys.stdout = sys.__stdout__
    sys.stderr = sys.__stderr__
    sys.setrecursionlimit(DEFAULT_RECURSION_LIMIT)
    sys.argv = [MAIN_NAME]
    builtins.input = _blocked_input
    os.chdir(HOME)

    with open(MAIN_NAME, "w", encoding="utf-8") as file:
        file.write(code)
    # mtime=None stops linecache from re-statting, so tracebacks always show this run's source.
    linecache.cache[MAIN_NAME] = (len(code), None, code.splitlines(True), MAIN_NAME)

    # A real module object, so unittest.main(), dataclasses and pickle can find __main__.
    main_module = types.ModuleType("__main__")
    main_module.__file__ = MAIN_NAME
    previous_main = sys.modules.get("__main__")
    sys.modules["__main__"] = main_module

    exit_code = 0
    try:
        try:
            compiled = compile(code, MAIN_NAME, "exec")
        except Exception as exc:
            traceback.print_exception(type(exc), exc, None)
            return 1
        try:
            exec(compiled, main_module.__dict__)
        except SystemExit as exc:
            if exc.code is None:
                exit_code = 0
            elif isinstance(exc.code, int):
                exit_code = exc.code
            else:
                print(exc.code, file=sys.stderr)
                exit_code = 1
        except BaseException as exc:
            # Drop this function's own frame so the traceback starts at main.py.
            traceback.print_exception(type(exc), exc, exc.__traceback__.tb_next)
            exit_code = 1
    finally:
        if previous_main is not None:
            sys.modules["__main__"] = previous_main
        for stream in (sys.stdout, sys.stderr):
            try:
                stream.flush()
            except Exception:
                pass
    return exit_code
```

**Write `src/runner/harness.ts`:**

```ts
import type { PyodideInterface } from "pyodide";
import harnessSource from "./harness.py?raw";

export interface Harness {
  findMissingImports(code: string): string[];
  installMissing(names: string[], report: (message: string) => void): Promise<void>;
  runMain(code: string): number;
}

type PyFunction = (...args: unknown[]) => unknown;

interface PyNamespace {
  get(name: string): PyFunction;
}

interface PyList {
  toJs(): string[];
  destroy(): void;
}

/** Executes harness.py in its own namespace and exposes its functions to JavaScript. */
export function loadHarness(pyodide: PyodideInterface): Harness {
  const namespace = pyodide.globals.get("dict")() as PyNamespace;
  pyodide.runPython(harnessSource, { globals: namespace as never, filename: "harness.py" });
  const findMissing = namespace.get("find_missing_imports");
  const installMissing = namespace.get("install_missing");
  const runMain = namespace.get("run_main");

  return {
    findMissingImports(code) {
      const result = findMissing(code) as PyList;
      try {
        return result.toJs();
      } finally {
        result.destroy();
      }
    },
    async installMissing(names, report) {
      await (installMissing(names, report) as PromiseLike<unknown>);
    },
    runMain: (code) => runMain(code) as number,
  };
}

const ignore = () => {};

/** Makes the program's imports available, runs it, and returns its exit code. */
export async function runProgram(
  pyodide: PyodideInterface,
  harness: Harness,
  code: string,
  report: (message: string) => void,
): Promise<number> {
  if (harness.findMissingImports(code).length > 0) {
    try {
      await pyodide.loadPackagesFromImports(code, {
        messageCallback: (message) => {
          if (message.startsWith("Loading ")) report(`${message}…`);
        },
        errorCallback: ignore,
      });
      const stillMissing = harness.findMissingImports(code);
      if (stillMissing.length > 0) {
        await pyodide.loadPackage("micropip", { messageCallback: ignore, errorCallback: ignore });
        await harness.installMissing(stillMissing, report);
      }
    } catch (error) {
      // Offline or CDN trouble: run anyway so the user sees Python's own ImportError.
      report(`Could not load packages: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return harness.runMain(code);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/harness.integration.test.ts`
Expected: PASS — 13 tests. The first run downloads numpy and micropip wheels from jsDelivr, so it needs network access.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

---

### Task 6: Runner controller, worker, and React hook

**Files:**
- Create: `src/runner/runnerController.ts`, `src/runner/pyodide.worker.ts`, `src/runner/createPyodideWorker.ts`, `src/runner/usePythonRunner.ts`
- Test: `src/runner/runnerController.test.ts`

**Interfaces:**
- Consumes: `WorkerRequest`, `WorkerResponse`, `PYODIDE_INDEX_URL` (Task 4); `OutputBuffer` (Task 4); `appendText`, `emptyConsole`, `ConsoleKind`, `ConsoleState` (Task 4); `loadHarness`, `runProgram` (Task 5).
- Produces:
  - `type RunnerStatus = "loading" | "ready" | "running" | "error"`
  - `interface WorkerHandle { post(message: WorkerRequest): void; terminate(): void }`
  - `type WorkerFactory = (onMessage: (message: WorkerResponse) => void, onError: (reason: string) => void) => WorkerHandle`
  - `interface RunnerEvents { status(status: RunnerStatus): void; text(kind: ConsoleKind, text: string): void; clear(): void }`
  - `class RunnerController { constructor(createWorker: WorkerFactory, events: RunnerEvents); start(); run(code: string); stop(); retry(); dispose() }`
  - `createPyodideWorker: WorkerFactory`
  - `usePythonRunner(): { status: RunnerStatus; consoleState: ConsoleState; run(code: string): void; stop(): void; retry(): void; clear(): void }`

- [ ] **Step 1: Write the failing controller test**

**Write `src/runner/runnerController.test.ts`:**

```ts
import { describe, expect, it } from "vitest";
import type { WorkerRequest, WorkerResponse } from "./protocol";
import { RunnerController, type RunnerStatus, type WorkerFactory } from "./runnerController";

interface FakeWorker {
  posted: WorkerRequest[];
  terminated: boolean;
  send(message: WorkerResponse): void;
  fail(reason: string): void;
}

function setup() {
  const workers: FakeWorker[] = [];
  const statuses: RunnerStatus[] = [];
  const texts: string[] = [];
  let clears = 0;

  const factory: WorkerFactory = (onMessage, onError) => {
    const worker: FakeWorker = { posted: [], terminated: false, send: onMessage, fail: onError };
    workers.push(worker);
    return {
      post: (message) => worker.posted.push(message),
      terminate: () => {
        worker.terminated = true;
      },
    };
  };

  const controller = new RunnerController(factory, {
    status: (status) => statuses.push(status),
    text: (kind, text) => texts.push(`${kind}:${text}`),
    clear: () => {
      clears += 1;
    },
  });
  controller.start();

  return {
    controller,
    workers,
    statuses,
    texts,
    clears: () => clears,
    lastStatus: () => statuses[statuses.length - 1],
  };
}

describe("RunnerController", () => {
  it("loads, then becomes ready", () => {
    const t = setup();
    expect(t.lastStatus()).toBe("loading");
    t.workers[0].send({ type: "ready" });
    expect(t.lastStatus()).toBe("ready");
  });

  it("ignores run requests until the runtime is ready", () => {
    const t = setup();
    t.controller.run("print(1)");
    expect(t.workers[0].posted).toEqual([]);
  });

  it("clears the console and posts the code when a run starts", () => {
    const t = setup();
    t.workers[0].send({ type: "ready" });
    t.controller.run("print(1)");
    expect(t.clears()).toBe(1);
    expect(t.lastStatus()).toBe("running");
    expect(t.workers[0].posted).toEqual([{ type: "run", runId: 1, code: "print(1)" }]);
  });

  it("forwards status and output, then summarises the run", () => {
    const t = setup();
    t.workers[0].send({ type: "ready" });
    t.controller.run("print(1)");
    t.workers[0].send({ type: "status", runId: 1, message: "Loading numpy…" });
    t.workers[0].send({
      type: "output",
      runId: 1,
      chunks: [
        { stream: "stdout", text: "1\n" },
        { stream: "stderr", text: "warn\n" },
      ],
    });
    t.workers[0].send({ type: "done", runId: 1, exitCode: 0, durationMs: 1234 });
    expect(t.texts).toEqual(["system:Loading numpy…\n", "stdout:1\n", "stderr:warn\n", "system:Finished in 1.23s\n"]);
    expect(t.lastStatus()).toBe("ready");
  });

  it("reports a non-zero exit code and starts system lines on a fresh line", () => {
    const t = setup();
    t.workers[0].send({ type: "ready" });
    t.controller.run("x");
    t.workers[0].send({ type: "output", runId: 1, chunks: [{ stream: "stdout", text: "no newline" }] });
    t.workers[0].send({ type: "done", runId: 1, exitCode: 1, durationMs: 50 });
    expect(t.texts[t.texts.length - 1]).toBe("system:\nExited with code 1 after 0.05s\n");
  });

  it("ignores messages that belong to an earlier run", () => {
    const t = setup();
    t.workers[0].send({ type: "ready" });
    t.controller.run("first");
    t.workers[0].send({ type: "done", runId: 1, exitCode: 0, durationMs: 1 });
    t.controller.run("second");
    const before = t.texts.length;
    t.workers[0].send({ type: "output", runId: 1, chunks: [{ stream: "stdout", text: "stale" }] });
    expect(t.texts).toHaveLength(before);
  });

  it("stops by replacing the worker, and ignores the old one afterwards", () => {
    const t = setup();
    t.workers[0].send({ type: "ready" });
    t.controller.run("while True: pass");
    t.controller.stop();
    expect(t.workers[0].terminated).toBe(true);
    expect(t.workers).toHaveLength(2);
    expect(t.texts).toContain("system:Stopped.\n");
    expect(t.lastStatus()).toBe("loading");

    t.workers[0].send({ type: "output", runId: 1, chunks: [{ stream: "stdout", text: "ghost" }] });
    expect(t.texts).not.toContain("stdout:ghost");

    t.workers[1].send({ type: "ready" });
    t.controller.run("print(2)");
    expect(t.workers[1].posted).toEqual([{ type: "run", runId: 2, code: "print(2)" }]);
  });

  it("does nothing when stop is pressed while idle", () => {
    const t = setup();
    t.workers[0].send({ type: "ready" });
    t.controller.stop();
    expect(t.workers).toHaveLength(1);
  });

  it("restarts the worker when the interpreter crashes mid-run", () => {
    const t = setup();
    t.workers[0].send({ type: "ready" });
    t.controller.run("boom");
    t.workers[0].send({ type: "crashed", runId: 1, message: "memory access out of bounds" });
    expect(t.texts.join("")).toContain("The Python runtime crashed: memory access out of bounds");
    expect(t.workers).toHaveLength(2);
    expect(t.lastStatus()).toBe("loading");
  });

  it("enters the error state when the runtime cannot load, and can retry", () => {
    const t = setup();
    t.workers[0].send({ type: "fatal", message: "Failed to fetch" });
    expect(t.lastStatus()).toBe("error");
    expect(t.texts.join("")).toContain("Could not load the Python runtime: Failed to fetch");
    expect(t.workers[0].terminated).toBe(true);

    t.controller.retry();
    expect(t.workers).toHaveLength(2);
    expect(t.lastStatus()).toBe("loading");
  });

  it("treats a worker error while loading as a load failure, but restarts after a later one", () => {
    const loading = setup();
    loading.workers[0].fail("script error");
    expect(loading.lastStatus()).toBe("error");
    expect(loading.workers).toHaveLength(1);

    const running = setup();
    running.workers[0].send({ type: "ready" });
    running.controller.run("x");
    running.workers[0].fail("out of memory");
    expect(running.workers).toHaveLength(2);
    expect(running.lastStatus()).toBe("loading");
  });

  it("silences a disposed worker", () => {
    const t = setup();
    t.controller.dispose();
    expect(t.workers[0].terminated).toBe(true);
    const before = t.statuses.length;
    t.workers[0].send({ type: "ready" });
    expect(t.statuses).toHaveLength(before);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/runner/runnerController.test.ts`
Expected: FAIL — "Failed to resolve import" for `./runnerController`.

- [ ] **Step 3: Write the controller**

**Write `src/runner/runnerController.ts`:**

```ts
import type { ConsoleKind } from "./consoleModel";
import type { WorkerRequest, WorkerResponse } from "./protocol";

export type RunnerStatus = "loading" | "ready" | "running" | "error";

export interface WorkerHandle {
  post(message: WorkerRequest): void;
  terminate(): void;
}

export type WorkerFactory = (
  onMessage: (message: WorkerResponse) => void,
  onError: (reason: string) => void,
) => WorkerHandle;

export interface RunnerEvents {
  status(status: RunnerStatus): void;
  text(kind: ConsoleKind, text: string): void;
  clear(): void;
}

function summarize(exitCode: number, durationMs: number): string {
  const seconds = (durationMs / 1000).toFixed(2);
  return exitCode === 0 ? `Finished in ${seconds}s` : `Exited with code ${exitCode} after ${seconds}s`;
}

/** Owns the Pyodide worker's lifecycle: loading, running, stopping, and recovering. */
export class RunnerController {
  private readonly createWorker: WorkerFactory;
  private readonly events: RunnerEvents;
  private worker: WorkerHandle | null = null;
  // Bumped whenever the worker is replaced, so callbacks from an old worker are ignored.
  private generation = 0;
  private status: RunnerStatus = "loading";
  private runId = 0;
  private atLineStart = true;

  constructor(createWorker: WorkerFactory, events: RunnerEvents) {
    this.createWorker = createWorker;
    this.events = events;
  }

  start(): void {
    this.spawn();
  }

  run(code: string): void {
    if (this.status !== "ready" || !this.worker) return;
    this.runId += 1;
    this.atLineStart = true;
    this.events.clear();
    this.setStatus("running");
    this.worker.post({ type: "run", runId: this.runId, code });
  }

  /** Terminating the worker is the only way to interrupt Python stuck in a tight loop. */
  stop(): void {
    if (this.status !== "running") return;
    this.system("Stopped.");
    this.spawn();
  }

  retry(): void {
    if (this.status === "error") this.spawn();
  }

  dispose(): void {
    this.generation += 1;
    this.worker?.terminate();
    this.worker = null;
  }

  private spawn(): void {
    this.worker?.terminate();
    this.generation += 1;
    const generation = this.generation;
    this.setStatus("loading");
    this.worker = this.createWorker(
      (message) => {
        if (generation === this.generation) this.handleMessage(message);
      },
      (reason) => {
        if (generation === this.generation) this.handleError(reason);
      },
    );
  }

  private handleMessage(message: WorkerResponse): void {
    if (message.type === "ready") {
      this.setStatus("ready");
      return;
    }
    if (message.type === "fatal") {
      this.giveUp(`Could not load the Python runtime: ${message.message}`);
      return;
    }
    if (this.status !== "running" || message.runId !== this.runId) return;

    switch (message.type) {
      case "status":
        this.system(message.message);
        break;
      case "output":
        for (const chunk of message.chunks) {
          this.events.text(chunk.stream, chunk.text);
          this.atLineStart = chunk.text.endsWith("\n");
        }
        break;
      case "done":
        this.system(summarize(message.exitCode, message.durationMs));
        this.setStatus("ready");
        break;
      case "crashed":
        this.system(`The Python runtime crashed: ${message.message}`);
        this.system("Restarting…");
        this.spawn();
        break;
    }
  }

  private handleError(reason: string): void {
    if (this.status === "loading") {
      this.giveUp(`Could not start the Python runtime: ${reason}`);
      return;
    }
    this.system(`The Python runtime crashed: ${reason}`);
    this.system("Restarting…");
    this.spawn();
  }

  private giveUp(message: string): void {
    this.system(message);
    this.worker?.terminate();
    this.worker = null;
    this.setStatus("error");
  }

  private system(message: string): void {
    this.events.text("system", `${this.atLineStart ? "" : "\n"}${message}\n`);
    this.atLineStart = true;
  }

  private setStatus(status: RunnerStatus): void {
    this.status = status;
    this.events.status(status);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/runner/runnerController.test.ts`
Expected: PASS — 12 tests.

- [ ] **Step 5: Write the worker, the real factory, and the hook**

**Write `src/runner/pyodide.worker.ts`:**

```ts
import type { PyodideInterface } from "pyodide";
import { loadHarness, runProgram, type Harness } from "./harness";
import { OutputBuffer } from "./outputBuffer";
import { PYODIDE_INDEX_URL, type OutputStream, type WorkerRequest, type WorkerResponse } from "./protocol";

// Typed by hand: the DOM and WebWorker TypeScript libs conflict when both are loaded.
const ctx = self as unknown as {
  postMessage(message: WorkerResponse): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

let currentRunId = 0;
const output = new OutputBuffer((chunks) => ctx.postMessage({ type: "output", runId: currentRunId, chunks }));

function writer(stream: OutputStream) {
  const decoder = new TextDecoder();
  return {
    isatty: false,
    write(bytes: Uint8Array): number {
      output.write(stream, decoder.decode(bytes, { stream: true }));
      return bytes.length;
    },
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function boot(): Promise<{ pyodide: PyodideInterface; harness: Harness }> {
  const { loadPyodide } = (await import(/* @vite-ignore */ `${PYODIDE_INDEX_URL}pyodide.mjs`)) as typeof import("pyodide");
  const pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX_URL });
  pyodide.setStdout(writer("stdout"));
  pyodide.setStderr(writer("stderr"));
  return { pyodide, harness: loadHarness(pyodide) };
}

const runtime = boot();
runtime.then(
  () => ctx.postMessage({ type: "ready" }),
  (error) => ctx.postMessage({ type: "fatal", message: describe(error) }),
);

ctx.onmessage = async (event) => {
  const { runId, code } = event.data;
  currentRunId = runId;
  const startedAt = performance.now();
  try {
    const { pyodide, harness } = await runtime;
    const exitCode = await runProgram(pyodide, harness, code, (message) =>
      ctx.postMessage({ type: "status", runId, message }),
    );
    output.flush();
    ctx.postMessage({ type: "done", runId, exitCode, durationMs: performance.now() - startedAt });
  } catch (error) {
    // Python exceptions are handled inside the harness; reaching here means the interpreter broke.
    output.flush();
    ctx.postMessage({ type: "crashed", runId, message: describe(error) });
  }
};
```

**Write `src/runner/createPyodideWorker.ts`:**

```ts
import type { WorkerResponse } from "./protocol";
import type { WorkerFactory } from "./runnerController";

export const createPyodideWorker: WorkerFactory = (onMessage, onError) => {
  const worker = new Worker(new URL("./pyodide.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => onMessage(event.data);
  worker.onerror = (event) => {
    event.preventDefault();
    onError(event.message || "the worker script failed to load");
  };
  return {
    post: (message) => worker.postMessage(message),
    terminate: () => worker.terminate(),
  };
};
```

**Write `src/runner/usePythonRunner.ts`:**

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { appendText, emptyConsole, type ConsoleKind, type ConsoleState } from "./consoleModel";
import { createPyodideWorker } from "./createPyodideWorker";
import { RunnerController, type RunnerStatus } from "./runnerController";

// Console text is committed to React state at most this often, however fast it arrives.
const COMMIT_INTERVAL_MS = 32;

interface PendingText {
  kind: ConsoleKind;
  text: string;
}

export function usePythonRunner() {
  const [status, setStatus] = useState<RunnerStatus>("loading");
  const [consoleState, setConsoleState] = useState<ConsoleState>(emptyConsole);
  const controllerRef = useRef<RunnerController | null>(null);
  const pendingRef = useRef<PendingText[]>([]);
  const timerRef = useRef<number | null>(null);

  const discardPending = useCallback(() => {
    pendingRef.current = [];
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clear = useCallback(() => {
    discardPending();
    setConsoleState(emptyConsole);
  }, [discardPending]);

  useEffect(() => {
    const commit = () => {
      timerRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = [];
      setConsoleState((state) => pending.reduce((next, item) => appendText(next, item.kind, item.text), state));
    };

    const controller = new RunnerController(createPyodideWorker, {
      status: setStatus,
      text: (kind, text) => {
        pendingRef.current.push({ kind, text });
        if (timerRef.current === null) timerRef.current = window.setTimeout(commit, COMMIT_INTERVAL_MS);
      },
      clear,
    });
    controllerRef.current = controller;
    controller.start();

    return () => {
      controller.dispose();
      controllerRef.current = null;
      discardPending();
    };
  }, [clear, discardPending]);

  const run = useCallback((code: string) => controllerRef.current?.run(code), []);
  const stop = useCallback(() => controllerRef.current?.stop(), []);
  const retry = useCallback(() => controllerRef.current?.retry(), []);

  return { status, consoleState, run, stop, retry, clear };
}
```

- [ ] **Step 6: Typecheck and run all unit tests**

Run: `npm run typecheck && npx vitest run src`
Expected: no type errors; all unit tests pass. (The worker and hook are exercised end to end in Task 9.)

---

### Task 7: React bindings for pads and timer

**Files:**
- Create: `src/pads/usePads.ts`, `src/timer/useTimer.ts`, `src/platform.ts`

**Interfaces:**
- Consumes: everything produced by Task 2 (`padStore.ts`, `storage.ts`) and Task 3 (`timer.ts`).
- Produces:
  - `usePads(): { pads: Pad[]; active: Pad; saveFailed: boolean; create(): void; select(id: string): void; rename(id: string, title: string): void; updateCode(id: string, code: string): void; remove(id: string): void }`
  - `useTimer(): TimerControls` where `interface TimerControls { state: TimerState; remainingMs: number; phase: TimerPhase; start(): void; pause(): void; resume(): void; reset(): void; setMinutes(minutes: number): void }`
  - `RUN_SHORTCUT_LABEL: string` ("⌘↵" on Apple platforms, "Ctrl+↵" elsewhere)

These are thin glue over tested pure modules, so they have no unit tests of their own; Task 9 covers them end to end.

- [ ] **Step 1: Write the hooks**

**Write `src/pads/usePads.ts`:**

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { getStorage } from "../storage";
import {
  activePad,
  createPad,
  deletePad,
  loadState,
  renamePad,
  saveState,
  selectPad,
  updateCode as updatePadCode,
  type PadState,
} from "./padStore";

const AUTOSAVE_DELAY_MS = 500;

export function usePads() {
  const [state, setState] = useState<PadState>(() => loadState(getStorage()));
  const [saveFailed, setSaveFailed] = useState(false);
  const latest = useRef(state);

  useEffect(() => {
    latest.current = state;
    const timer = window.setTimeout(() => setSaveFailed(!saveState(getStorage(), state)), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  // Closing or reloading the tab inside the debounce window must not lose the last edit.
  useEffect(() => {
    const flush = () => {
      saveState(getStorage(), latest.current);
    };
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, []);

  const create = useCallback(() => setState((current) => createPad(current)), []);
  const select = useCallback((id: string) => setState((current) => selectPad(current, id)), []);
  const rename = useCallback((id: string, title: string) => setState((current) => renamePad(current, id, title)), []);
  const updateCode = useCallback((id: string, code: string) => setState((current) => updatePadCode(current, id, code)), []);
  const remove = useCallback((id: string) => setState((current) => deletePad(current, id)), []);

  return { pads: state.pads, active: activePad(state), saveFailed, create, select, rename, updateCode, remove };
}
```

**Write `src/timer/useTimer.ts`:**

```ts
import { useCallback, useEffect, useState } from "react";
import { getStorage } from "../storage";
import {
  TIMER_KEY,
  parseTimer,
  pause as pauseTimer,
  remainingMs,
  reset as resetTimer,
  resume as resumeTimer,
  setDuration,
  start as startTimer,
  timerPhase,
  type TimerPhase,
  type TimerState,
} from "./timer";

const TICK_MS = 250;

export interface TimerControls {
  state: TimerState;
  remainingMs: number;
  phase: TimerPhase;
  start(): void;
  pause(): void;
  resume(): void;
  reset(): void;
  setMinutes(minutes: number): void;
}

export function useTimer(): TimerControls {
  const [state, setState] = useState<TimerState>(() => parseTimer(getStorage()?.getItem(TIMER_KEY) ?? null));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    try {
      getStorage()?.setItem(TIMER_KEY, JSON.stringify(state));
    } catch {
      // The timer still works for this session without persistence.
    }
  }, [state]);

  useEffect(() => {
    if (state.status !== "running") return;
    const interval = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(interval);
  }, [state.status]);

  // Every transition also refreshes `now`, so the readout never uses a stale clock.
  const apply = useCallback((transition: (current: TimerState, at: number) => TimerState) => {
    const at = Date.now();
    setNow(at);
    setState((current) => transition(current, at));
  }, []);

  const start = useCallback(() => apply(startTimer), [apply]);
  const pause = useCallback(() => apply(pauseTimer), [apply]);
  const resume = useCallback(() => apply(resumeTimer), [apply]);
  const reset = useCallback(() => apply((current) => resetTimer(current)), [apply]);
  const setMinutes = useCallback((minutes: number) => apply((current) => setDuration(current, minutes)), [apply]);

  return { state, remainingMs: remainingMs(state, now), phase: timerPhase(state, now), start, pause, resume, reset, setMinutes };
}
```

**Write `src/platform.ts`:**

```ts
const isApple = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Label for the run shortcut, which is Cmd+Enter on Apple platforms and Ctrl+Enter elsewhere. */
export const RUN_SHORTCUT_LABEL = isApple ? "⌘↵" : "Ctrl+↵";
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

---

### Task 8: User interface

**Files:**
- Create: `src/components/icons.tsx`, `src/components/TitleField.tsx`, `src/components/Timer.tsx`, `src/components/TopBar.tsx`, `src/components/PadSidebar.tsx`, `src/components/CodeEditor.tsx`, `src/components/OutputConsole.tsx`, `src/components/SplitPane.tsx`
- Modify (replace whole file): `src/App.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: `usePads` and `useTimer`/`TimerControls` (Task 7); `usePythonRunner`, `RunnerStatus`, `ConsoleState` (Tasks 4 and 6); `Pad`, `sortedByRecent`, `formatUpdated` (Task 2); `PRESET_MINUTES`, `MIN_MINUTES`, `MAX_MINUTES`, `formatRemaining` (Task 3); `RUN_SHORTCUT_LABEL` (Task 7); `getStorage` (Task 2).
- Produces accessible hooks that Task 9's end-to-end tests rely on: a button named exactly `Run`, a button named `Stop`, a button named `New pad`, a region labelled `Program output`, and an element with `role="timer"` containing buttons `Start`, `Pause`, `Resume`, `Reset`.

- [ ] **Step 1: Write the small shared components**

**Write `src/components/icons.tsx`:**

```tsx
import type { ReactNode } from "react";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const PlayIcon = () => (
  <Icon>
    <path d="M4.5 2.8v10.4L13 8z" fill="currentColor" stroke="none" />
  </Icon>
);

export const StopIcon = () => (
  <Icon>
    <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="currentColor" stroke="none" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon>
    <path d="M8 3.5v9M3.5 8h9" />
  </Icon>
);

export const PencilIcon = () => (
  <Icon>
    <path d="M10.8 2.7l2.5 2.5L5.5 13H3v-2.5z" />
  </Icon>
);

export const TrashIcon = () => (
  <Icon>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
  </Icon>
);

export const SidebarIcon = () => (
  <Icon>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M6 3v10" />
  </Icon>
);
```

**Write `src/components/TitleField.tsx`:**

```tsx
import { useRef, useState } from "react";

interface TitleFieldProps {
  title: string;
  ariaLabel: string;
  className: string;
  autoFocus?: boolean;
  onCommit(title: string): void;
  onDone?(): void;
}

/** Inline text field for a pad title: Enter or blur commits, Escape cancels. */
export function TitleField({ title, ariaLabel, className, autoFocus = false, onCommit, onDone }: TitleFieldProps) {
  const [draft, setDraft] = useState(title);
  const cancelled = useRef(false);

  const finish = () => {
    const next = draft.trim();
    if (!cancelled.current && next !== "" && next !== title) onCommit(next);
    else setDraft(title);
    cancelled.current = false;
    onDone?.();
  };

  return (
    <input
      className={className}
      aria-label={ariaLabel}
      value={draft}
      autoFocus={autoFocus}
      spellCheck={false}
      onFocus={(event) => {
        if (autoFocus) event.currentTarget.select();
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          cancelled.current = true;
          event.currentTarget.blur();
        }
      }}
    />
  );
}
```

**Write `src/components/Timer.tsx`:**

```tsx
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
```

- [ ] **Step 2: Write the top bar and the pad sidebar**

**Write `src/components/TopBar.tsx`:**

```tsx
import type { ReactNode } from "react";
import { RUN_SHORTCUT_LABEL } from "../platform";
import type { RunnerStatus } from "../runner/runnerController";
import { PlayIcon, SidebarIcon, StopIcon } from "./icons";
import { TitleField } from "./TitleField";

interface TopBarProps {
  padId: string;
  title: string;
  status: RunnerStatus;
  sidebarOpen: boolean;
  timer: ReactNode;
  onToggleSidebar(): void;
  onRename(title: string): void;
  onRun(): void;
  onStop(): void;
}

const STATUS_TEXT: Record<RunnerStatus, string> = {
  loading: "Loading Python…",
  ready: "Python ready",
  running: "Running…",
  error: "Python unavailable",
};

export function TopBar({ padId, title, status, sidebarOpen, timer, onToggleSidebar, onRename, onRun, onStop }: TopBarProps) {
  return (
    <header className="topbar">
      <button
        type="button"
        className="icon-button"
        aria-label={sidebarOpen ? "Hide pads" : "Show pads"}
        aria-pressed={sidebarOpen}
        onClick={onToggleSidebar}
      >
        <SidebarIcon />
      </button>
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          &gt;_
        </span>
        <span className="brand-name">PracticePad</span>
      </div>
      {/* Keyed so the draft resets when the pad or its saved title changes. */}
      <TitleField key={`${padId}:${title}`} title={title} ariaLabel="Pad title" className="title-input" onCommit={onRename} />
      <span className="pill">Python 3.14</span>
      <div className="topbar-spacer" />
      {timer}
      <span className={`runtime-status runtime-${status}`} role="status">
        {STATUS_TEXT[status]}
      </span>
      {status === "running" ? (
        <button type="button" className="run-button is-stop" onClick={onStop}>
          <StopIcon />
          Stop
        </button>
      ) : (
        <button type="button" className="run-button" onClick={onRun} disabled={status !== "ready"}>
          <PlayIcon />
          Run
          <span className="kbd" aria-hidden="true">
            {RUN_SHORTCUT_LABEL}
          </span>
        </button>
      )}
    </header>
  );
}
```

**Write `src/components/PadSidebar.tsx`:**

```tsx
import { useState } from "react";
import { formatUpdated } from "../pads/formatUpdated";
import { sortedByRecent, type Pad } from "../pads/padStore";
import { PencilIcon, PlusIcon, TrashIcon } from "./icons";
import { TitleField } from "./TitleField";

interface PadSidebarProps {
  pads: Pad[];
  activeId: string;
  saveFailed: boolean;
  onCreate(): void;
  onSelect(id: string): void;
  onRename(id: string, title: string): void;
  onDelete(id: string): void;
}

export function PadSidebar({ pads, activeId, saveFailed, onCreate, onSelect, onRename, onDelete }: PadSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const now = Date.now();

  return (
    <aside className="sidebar" aria-label="Pads">
      <div className="sidebar-header">
        <span>Pads</span>
        <button type="button" className="text-button" onClick={onCreate}>
          <PlusIcon />
          New pad
        </button>
      </div>
      <ul className="pad-list">
        {sortedByRecent(pads).map((pad) => (
          <li key={pad.id} className={`pad-item${pad.id === activeId ? " is-active" : ""}`}>
            {editingId === pad.id ? (
              <TitleField
                title={pad.title}
                ariaLabel={`Rename ${pad.title}`}
                className="pad-rename"
                autoFocus
                onCommit={(title) => onRename(pad.id, title)}
                onDone={() => setEditingId(null)}
              />
            ) : (
              <>
                <button
                  type="button"
                  className="pad-select"
                  aria-current={pad.id === activeId ? "true" : undefined}
                  onClick={() => onSelect(pad.id)}
                >
                  <span className="pad-title">{pad.title}</span>
                  <span className="pad-meta">Edited {formatUpdated(pad.updatedAt, now)}</span>
                </button>
                <div className="pad-actions">
                  <button type="button" className="icon-button" aria-label={`Rename ${pad.title}`} onClick={() => setEditingId(pad.id)}>
                    <PencilIcon />
                  </button>
                  <button
                    type="button"
                    className="icon-button is-danger"
                    aria-label={`Delete ${pad.title}`}
                    onClick={() => {
                      if (window.confirm(`Delete "${pad.title}"? This can't be undone.`)) onDelete(pad.id);
                    }}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {saveFailed && (
        <p className="sidebar-warning" role="alert">
          This browser is blocking storage, so pads won't survive a reload. Copy out anything you want to keep.
        </p>
      )}
    </aside>
  );
}
```

- [ ] **Step 3: Write the editor, console, and split pane**

**Write `src/components/CodeEditor.tsx`:**

```tsx
import Editor, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import { useEffect, useRef } from "react";

interface CodeEditorProps {
  padId: string;
  code: string;
  onChange(code: string): void;
  onRun(): void;
}

const THEME = "practicepad-dark";

const defineTheme: BeforeMount = (monaco) => {
  monaco.editor.defineTheme(THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#14161b",
      "editor.lineHighlightBackground": "#1b1e25",
      "editorLineNumber.foreground": "#4a5162",
      "editorLineNumber.activeForeground": "#a9b1c2",
      "editorGutter.background": "#14161b",
    },
  });
};

export function CodeEditor({ padId, code, onChange, onRun }: CodeEditorProps) {
  // Monaco keeps the command registered at mount, so it must reach the latest handler through a ref.
  const onRunRef = useRef(onRun);
  useEffect(() => {
    onRunRef.current = onRun;
  }, [onRun]);

  const handleMount: OnMount = (editor, monaco) => {
    // Replaces Monaco's default Cmd/Ctrl+Enter ("insert line below") with Run.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onRunRef.current());
    editor.focus();
  };

  return (
    <Editor
      height="100%"
      language="python"
      theme={THEME}
      // One Monaco model per pad keeps undo history separate between pads.
      path={`${padId}.py`}
      value={code}
      onChange={(value) => onChange(value ?? "")}
      beforeMount={defineTheme}
      onMount={handleMount}
      loading={<div className="editor-loading">Loading editor…</div>}
      options={{
        fontSize: 14,
        fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, Consolas, monospace',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 4,
        insertSpaces: true,
        renderLineHighlight: "line",
        padding: { top: 12, bottom: 12 },
      }}
    />
  );
}
```

**Write `src/components/OutputConsole.tsx`:**

```tsx
import { useLayoutEffect, useRef } from "react";
import { RUN_SHORTCUT_LABEL } from "../platform";
import type { ConsoleState } from "../runner/consoleModel";
import type { RunnerStatus } from "../runner/runnerController";

interface OutputConsoleProps {
  consoleState: ConsoleState;
  status: RunnerStatus;
  onClear(): void;
  onRetry(): void;
}

const STICK_THRESHOLD_PX = 24;

export function OutputConsole({ consoleState, status, onClear, onRetry }: OutputConsoleProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const isEmpty = consoleState.segments.length === 0;

  // Follow new output unless the user has scrolled up to read something.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (isEmpty) stickToBottom.current = true;
    if (stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [consoleState, isEmpty]);

  return (
    <section className="split-pane console" aria-label="Program output">
      <header className="pane-header">
        <span>Output</span>
        <button type="button" className="text-button" onClick={onClear} disabled={isEmpty}>
          Clear
        </button>
      </header>
      <div
        className="console-scroll"
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < STICK_THRESHOLD_PX;
        }}
      >
        {isEmpty ? (
          <p className="console-hint">
            Press Run or <kbd>{RUN_SHORTCUT_LABEL}</kbd> to execute your code. Output, errors, and package installs show up here.
          </p>
        ) : (
          <pre className="console-text">
            {consoleState.truncated && <span className="console-system">… earlier output truncated{"\n"}</span>}
            {consoleState.segments.map((segment) => (
              <span key={segment.id} className={`console-${segment.kind}`}>
                {segment.text}
              </span>
            ))}
          </pre>
        )}
        {status === "error" && (
          <button type="button" className="text-button console-retry" onClick={onRetry}>
            Retry loading Python
          </button>
        )}
      </div>
    </section>
  );
}
```

**Write `src/components/SplitPane.tsx`:**

```tsx
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
```

- [ ] **Step 4: Compose the app**

**Write `src/App.tsx`:**

```tsx
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CodeEditor } from "./components/CodeEditor";
import { OutputConsole } from "./components/OutputConsole";
import { PadSidebar } from "./components/PadSidebar";
import { SplitPane } from "./components/SplitPane";
import { Timer } from "./components/Timer";
import { TopBar } from "./components/TopBar";
import { usePads } from "./pads/usePads";
import { usePythonRunner } from "./runner/usePythonRunner";
import { useTimer } from "./timer/useTimer";

const SIDEBAR_MIN_WIDTH_PX = 900;
// Matches the breakpoint in styles.css where the sidebar floats over the editor.
const FLOATING_SIDEBAR_QUERY = "(max-width: 760px)";

export function App() {
  const pads = usePads();
  const runner = usePythonRunner();
  const timer = useTimer();
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= SIDEBAR_MIN_WIDTH_PX);

  const { active, updateCode, rename, select, create } = pads;
  const { run } = runner;

  // A floating sidebar covers the editor, so get it out of the way once a pad is chosen.
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

  // The run shortcut is registered once, so it reads the current code through a ref.
  const codeRef = useRef(active.code);
  useLayoutEffect(() => {
    codeRef.current = active.code;
  }, [active.code]);
  const runActive = useCallback(() => run(codeRef.current), [run]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        runActive();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runActive]);

  const handleChange = useCallback((code: string) => updateCode(active.id, code), [updateCode, active.id]);
  const handleRename = useCallback((title: string) => rename(active.id, title), [rename, active.id]);

  return (
    <div className="app">
      <TopBar
        padId={active.id}
        title={active.title}
        status={runner.status}
        sidebarOpen={sidebarOpen}
        timer={<Timer timer={timer} />}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
        onRename={handleRename}
        onRun={runActive}
        onStop={runner.stop}
      />
      <div className="workspace">
        {sidebarOpen && (
          <PadSidebar
            pads={pads.pads}
            activeId={active.id}
            saveFailed={pads.saveFailed}
            onCreate={handleCreate}
            onSelect={handleSelect}
            onRename={pads.rename}
            onDelete={pads.remove}
          />
        )}
        <SplitPane
          left={
            <section className="split-pane" aria-label="Code editor">
              <header className="pane-header">
                <span className="file-tab">main.py</span>
              </header>
              <div className="editor-host">
                <CodeEditor padId={active.id} code={active.code} onChange={handleChange} onRun={runActive} />
              </div>
            </section>
          }
          right={
            <OutputConsole
              consoleState={runner.consoleState}
              status={runner.status}
              onClear={runner.clear}
              onRetry={runner.retry}
            />
          }
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write the stylesheet**

**Write `src/styles.css`:**

```css
:root {
  color-scheme: dark;
  --bg: #0e1014;
  --panel: #14161b;
  --bar: #181b21;
  --raised: #20242c;
  --border: #272b34;
  --text: #e4e7ee;
  --dim: #8a92a3;
  --accent: #5aa2ff;
  --run: #2fbf71;
  --run-text: #04210f;
  --danger: #ef5f5f;
  --warn: #f0b429;
  --mono: "JetBrains Mono", "Fira Code", "SF Mono", Menlo, Consolas, monospace;
  --sans: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
  margin: 0;
}

body {
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  font: 14px/1.4 var(--sans);
}

button,
input,
select {
  color: inherit;
  font: inherit;
}

button {
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

/* Shell */

.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.workspace {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
}

/* Top bar */

.topbar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 12px;
  height: 48px;
  padding: 0 12px;
  overflow-x: auto;
  border-bottom: 1px solid var(--border);
  background: var(--bar);
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 650;
  white-space: nowrap;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: var(--run);
  color: var(--run-text);
  font: 700 11px var(--mono);
}

.title-input {
  flex: 0 1 240px;
  min-width: 80px;
  padding: 5px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  font-weight: 600;
  text-overflow: ellipsis;
}

.title-input:hover {
  border-color: var(--border);
}

.title-input:focus {
  border-color: var(--accent);
  outline: none;
  background: var(--panel);
}

.pill {
  padding: 3px 9px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--dim);
  font-size: 12px;
  white-space: nowrap;
}

.topbar-spacer {
  flex: 1;
}

.runtime-status {
  color: var(--dim);
  font-size: 12px;
  white-space: nowrap;
}

.runtime-error {
  color: var(--danger);
}

.run-button {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: 6px;
  background: var(--run);
  color: var(--run-text);
  font-weight: 650;
}

.run-button:hover:not(:disabled) {
  filter: brightness(1.08);
}

.run-button.is-stop {
  background: var(--danger);
  color: #2a0606;
}

.kbd {
  font: 11px var(--mono);
  opacity: 0.7;
}

.icon-button {
  display: grid;
  flex: none;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dim);
}

.icon-button:hover {
  background: var(--raised);
  color: var(--text);
}

.icon-button.is-danger:hover {
  color: var(--danger);
}

.text-button {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--raised);
  font-size: 12px;
  text-transform: none;
  letter-spacing: normal;
  white-space: nowrap;
}

.text-button:hover:not(:disabled) {
  border-color: var(--dim);
}

/* Timer */

.timer {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  padding: 3px 4px 3px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
}

.timer-readout {
  min-width: 5ch;
  font: 600 14px var(--mono);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.timer-warning {
  border-color: var(--warn);
}

.timer-warning .timer-readout {
  color: var(--warn);
}

.timer-expired {
  border-color: var(--danger);
  background: rgb(239 95 95 / 0.14);
}

.timer-expired .timer-readout {
  color: var(--danger);
}

.timer select,
.timer input {
  height: 26px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--panel);
  font-size: 12px;
}

.timer input {
  width: 58px;
}

/* Sidebar */

.sidebar {
  display: flex;
  flex: none;
  flex-direction: column;
  width: 240px;
  border-right: 1px solid var(--border);
  background: var(--panel);
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 10px 8px 14px;
  color: var(--dim);
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.pad-list {
  flex: 1;
  margin: 0;
  padding: 0 6px 8px;
  overflow-y: auto;
  list-style: none;
}

.pad-item {
  display: flex;
  align-items: center;
  margin-bottom: 2px;
  border-radius: 6px;
}

.pad-item:hover,
.pad-item.is-active {
  background: var(--raised);
}

.pad-item.is-active {
  box-shadow: inset 2px 0 0 var(--run);
}

.pad-select {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  padding: 7px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  text-align: left;
}

.pad-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pad-meta {
  color: var(--dim);
  font-size: 11px;
}

.pad-actions {
  display: flex;
  padding-right: 4px;
  opacity: 0;
}

.pad-item:hover .pad-actions,
.pad-item:focus-within .pad-actions {
  opacity: 1;
}

.pad-rename {
  flex: 1;
  min-width: 0;
  margin: 4px;
  padding: 5px 6px;
  border: 1px solid var(--accent);
  border-radius: 5px;
  outline: none;
  background: var(--bg);
}

.sidebar-warning {
  margin: 8px;
  padding: 8px 10px;
  border: 1px solid var(--warn);
  border-radius: 6px;
  color: var(--warn);
  font-size: 12px;
}

/* Split pane */

.split {
  display: grid;
  flex: 1;
  grid-template-columns: minmax(0, calc(var(--split) * 100%)) 6px minmax(0, 1fr);
  min-width: 0;
}

.split.is-dragging {
  cursor: col-resize;
  user-select: none;
}

.split-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.split-divider {
  background: var(--border);
  cursor: col-resize;
  touch-action: none;
}

.split-divider:hover,
.split-divider:focus-visible,
.split.is-dragging .split-divider {
  outline: none;
  background: var(--accent);
}

.pane-header {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  height: 34px;
  padding: 0 8px 0 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bar);
  color: var(--dim);
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.file-tab {
  color: var(--text);
  font: 12px var(--mono);
  letter-spacing: normal;
  text-transform: none;
}

.editor-host {
  flex: 1;
  min-height: 0;
  background: var(--panel);
}

.editor-loading {
  color: var(--dim);
}

/* Console */

.console {
  background: var(--bg);
}

.console-scroll {
  flex: 1;
  min-height: 0;
  padding: 12px 14px;
  overflow: auto;
}

.console-text {
  margin: 0;
  font: 13px/1.5 var(--mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.console-stderr {
  color: #ff8078;
}

.console-system {
  color: var(--dim);
  font-style: italic;
}

.console-hint {
  max-width: 46ch;
  margin: 0;
  color: var(--dim);
}

.console-hint kbd {
  padding: 1px 5px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font: 12px var(--mono);
}

.console-retry {
  margin-top: 12px;
}

/* Narrow screens: stack editor over output and float the sidebar. */

@media (max-width: 760px) {
  .split {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 3fr) minmax(0, 2fr);
  }

  .split-divider {
    display: none;
  }

  .console {
    border-top: 1px solid var(--border);
  }

  .sidebar {
    position: absolute;
    z-index: 5;
    top: 0;
    bottom: 0;
    left: 0;
    box-shadow: 8px 0 24px rgb(0 0 0 / 0.45);
  }

  /* Keep Run on screen: drop decoration and let the title give up its width first. */
  .topbar {
    gap: 6px;
    padding: 0 8px;
  }

  .timer {
    gap: 4px;
    padding-left: 6px;
  }

  .brand,
  .pill,
  .runtime-status,
  .run-button .kbd {
    display: none;
  }

  .title-input {
    flex: 1 1 40px;
    min-width: 40px;
  }
}
```

- [ ] **Step 6: Verify it builds**

Run: `npm run build`
Expected: no type errors; Vite emits `dist/` including a separate worker chunk (a file whose name contains `pyodide.worker`).

- [ ] **Step 7: Verify in a browser**

Run: `npm run dev`, open the printed URL, and check: the editor shows the starter code; the status moves from "Loading Python…" to "Python ready"; Run prints `Hello, World!` three times followed by "Finished in …s".

---

### Task 9: End-to-end tests and README

**Files:**
- Create: `playwright.config.ts`, `e2e/smoke.spec.ts`, `README.md`

**Interfaces:**
- Consumes: the accessible names listed under Task 8, and the storage keys `coderpad-sim:pads` / `coderpad-sim:active-pad` with the `Pad` shape from Task 2.

The tests run against the production build (`vite preview`), because worker bundling is the part most likely to differ from dev mode. They need network access: the page loads Monaco and Pyodide from jsDelivr.

- [ ] **Step 1: Write the Playwright config and tests**

**Write `playwright.config.ts`:**

```ts
import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "e2e",
  // Generous because the first run downloads Pyodide and numpy from the CDN.
  timeout: 180_000,
  expect: { timeout: 120_000 },
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
```

**Write `e2e/smoke.spec.ts`:**

```ts
import { expect, test, type Page } from "@playwright/test";

/** Seeds one pad before the app boots. Skipped on reloads so later edits survive. */
async function seedPad(page: Page, code: string) {
  await page.addInitScript((source) => {
    if (localStorage.getItem("coderpad-sim:pads")) return;
    const now = Date.now();
    const pad = { id: "seed", title: "Seeded pad", code: source, createdAt: now, updatedAt: now };
    localStorage.setItem("coderpad-sim:pads", JSON.stringify([pad]));
    localStorage.setItem("coderpad-sim:active-pad", "seed");
  }, code);
}

const runButton = (page: Page) => page.getByRole("button", { name: "Run", exact: true });
const output = (page: Page) => page.getByLabel("Program output");

test("runs real Python and imports numpy", async ({ page }) => {
  await seedPad(page, 'import numpy as np\nprint("sum:", np.arange(10).sum())\n');
  await page.goto("/");
  await expect(runButton(page)).toBeEnabled();
  await runButton(page).click();
  await expect(output(page)).toContainText("Loading numpy");
  await expect(output(page)).toContainText("sum: 45");
  await expect(output(page)).toContainText("Finished in");
});

test("shows a Python traceback that points at main.py", async ({ page }) => {
  await seedPad(page, "def f():\n    return 1 / 0\n\nf()\n");
  await page.goto("/");
  await expect(runButton(page)).toBeEnabled();
  await runButton(page).click();
  await expect(output(page)).toContainText('File "main.py", line 2, in f');
  await expect(output(page)).toContainText("ZeroDivisionError: division by zero");
  await expect(output(page)).toContainText("Exited with code 1");
});

test("stops an infinite loop and can run again", async ({ page }) => {
  await seedPad(page, 'import itertools\nfor i in itertools.count():\n    print("tick", i)\n');
  await page.goto("/");
  await expect(runButton(page)).toBeEnabled();
  await runButton(page).click();
  await expect(output(page)).toContainText("tick");

  await page.getByRole("button", { name: "Stop" }).click();
  await expect(output(page)).toContainText("Stopped.");

  // A new pad starts from the hello-world template.
  await page.getByRole("button", { name: "New pad" }).click();
  await expect(runButton(page)).toBeEnabled();
  await runButton(page).click();
  await expect(output(page)).toContainText("Hello, World!");
  await expect(output(page)).not.toContainText("tick");
});

test("keeps edits across a reload and runs with the keyboard shortcut", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator(".monaco-editor").first();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("print(6*7)");

  await page.reload();
  await expect(page.locator(".monaco-editor .view-lines").first()).toContainText("print(6*7)");

  await expect(runButton(page)).toBeEnabled();
  await page.locator(".monaco-editor").first().click();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(output(page)).toContainText("42");
});

test("timer counts down and survives a reload", async ({ page }) => {
  await page.goto("/");
  const timer = page.getByRole("timer");
  await expect(timer).toContainText("45:00");
  await timer.getByRole("button", { name: "Start" }).click();
  await expect(timer).toContainText(/44:5\d/);

  await page.reload();
  await expect(page.getByRole("timer")).toContainText(/44:\d\d/);
  await expect(page.getByRole("timer").getByRole("button", { name: "Pause" })).toBeVisible();
});
```

- [ ] **Step 2: Install the browser and run the tests**

Run:

```bash
npx playwright install chromium
npm run test:e2e
```

Expected: 5 passed.

- [ ] **Step 3: Write the README**

**Write `README.md`:**

````markdown
# PracticePad

A CoderPad-style interview practice playground that runs **real Python in your browser**.
Write code in a Monaco editor, press Run, and see real output, real tracebacks, and real
package imports, with an interview timer ticking in the corner.

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
- **Multiple pads, autosaved.** Pads live in `localStorage`. Create, rename, and delete them
  from the sidebar.
- **Shortcut.** Cmd+Enter (macOS) or Ctrl+Enter runs the current pad.

## Limits

- `input()` is not supported; hard-code your test inputs instead.
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
````

- [ ] **Step 4: Run the full verification suite**

Run: `npm run typecheck && npm test && npm run test:e2e`
Expected: no type errors; all Vitest tests pass; 5 Playwright tests pass.

