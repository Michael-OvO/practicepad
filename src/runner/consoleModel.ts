/** `input` is what the user typed for the program, echoed as a terminal would. */
export type ConsoleKind = "stdout" | "stderr" | "system" | "input";

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
