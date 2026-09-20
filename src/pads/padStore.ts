export interface TestCase {
  id: string;
  /** Fed to the program as stdin. */
  input: string;
  /** Compared with stdout; empty means "just show me the output". */
  expected: string;
}

export interface Pad {
  id: string;
  title: string;
  code: string;
  /** Free-form notes kept alongside the code (problem statement, approach, edge cases). */
  notes: string;
  tests: TestCase[];
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
  return { id, title: nextUntitledTitle(existing), code: STARTER_CODE, notes: "", tests: [], createdAt: now, updatedAt: now };
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

export function updateNotes(state: PadState, id: string, notes: string, now: number = Date.now()): PadState {
  return patchPad(state, id, { notes }, now);
}

function patchTests(state: PadState, padId: string, update: (tests: TestCase[]) => TestCase[], now: number): PadState {
  const pad = state.pads.find((candidate) => candidate.id === padId);
  if (!pad) return state;
  return patchPad(state, padId, { tests: update(pad.tests) }, now);
}

function hasTest(state: PadState, padId: string, testId: string): boolean {
  return state.pads.find((candidate) => candidate.id === padId)?.tests.some((test) => test.id === testId) ?? false;
}

export function addTest(state: PadState, padId: string, now: number = Date.now(), id: string = crypto.randomUUID()): PadState {
  return patchTests(state, padId, (tests) => [...tests, { id, input: "", expected: "" }], now);
}

export function updateTest(
  state: PadState,
  padId: string,
  testId: string,
  patch: Partial<Pick<TestCase, "input" | "expected">>,
  now: number = Date.now(),
): PadState {
  if (!hasTest(state, padId, testId)) return state;
  return patchTests(state, padId, (tests) => tests.map((test) => (test.id === testId ? { ...test, ...patch } : test)), now);
}

export function removeTest(state: PadState, padId: string, testId: string, now: number = Date.now()): PadState {
  if (!hasTest(state, padId, testId)) return state;
  return patchTests(state, padId, (tests) => tests.filter((test) => test.id !== testId), now);
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

function isTestCase(value: unknown): value is TestCase {
  if (typeof value !== "object" || value === null) return false;
  const test = value as Record<string, unknown>;
  return typeof test.id === "string" && typeof test.input === "string" && typeof test.expected === "string";
}

function isPad(value: unknown): value is Omit<Pad, "notes" | "tests"> & { notes?: string; tests?: unknown[] } {
  if (typeof value !== "object" || value === null) return false;
  const pad = value as Record<string, unknown>;
  return (
    typeof pad.id === "string" &&
    typeof pad.title === "string" &&
    typeof pad.code === "string" &&
    (pad.notes === undefined || typeof pad.notes === "string") &&
    (pad.tests === undefined || Array.isArray(pad.tests)) &&
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
    // Pads saved before notes or test cases existed load with them empty.
    const pads: Pad[] = Array.isArray(parsed)
      ? parsed.filter(isPad).map((pad) => ({ ...pad, notes: pad.notes ?? "", tests: (pad.tests ?? []).filter(isTestCase) }))
      : [];
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
