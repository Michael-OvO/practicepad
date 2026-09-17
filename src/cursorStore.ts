export interface CursorPosition {
  line: number;
  column: number;
}

/**
 * The editor's cursor position, kept outside React state on purpose: it changes on every
 * keystroke, and only the status bar cares. Subscribers re-render; the rest of the app does not.
 */
export class CursorStore {
  private position: CursorPosition = { line: 1, column: 1 };
  private readonly listeners = new Set<() => void>();

  get = (): CursorPosition => this.position;

  set = (line: number, column: number): void => {
    if (line === this.position.line && column === this.position.column) return;
    this.position = { line, column };
    for (const listener of this.listeners) listener();
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}
