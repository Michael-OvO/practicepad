import { formatUpdated } from "./formatUpdated";
import { loadState, saveState, sortedByRecent, type PadState } from "./padStore";

type PadStorage = Pick<Storage, "getItem" | "setItem"> | null;

/**
 * Holds the pads outside React so the latest state can always be read synchronously.
 *
 * React applies state updates asynchronously. Anything that must see the very last keystroke
 * (saving while the tab closes, running code right after typing) would otherwise read a
 * snapshot from before the most recent render.
 *
 * React is also told about changes only when they alter what it shows. The editor owns the text
 * while it is typed, so a keystroke usually changes nothing on screen outside the editor, and
 * re-rendering the whole app for each one made typing lag. Such edits update the state but not
 * the published snapshot, whose text therefore lags behind: read the state for the text.
 */
export class PadSession {
  private readonly storage: PadStorage;
  private state: PadState;
  private snapshot: PadState;
  private readonly subscribers = new Set<() => void>();
  private readonly changeListeners = new Set<() => void>();

  constructor(storage: PadStorage) {
    this.storage = storage;
    this.state = loadState(storage);
    this.snapshot = this.state;
  }

  // Arrow properties so they can be handed straight to useSyncExternalStore.
  /** The latest state, including every keystroke. */
  getState = (): PadState => this.state;

  /** What React renders. Replaced, and subscribers told, only when the pad list changes. */
  getSnapshot = (): PadState => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  };

  /** Called on every change, keystrokes included; for saving. */
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  apply(transition: (state: PadState) => PadState): void {
    if (!this.commit(transition)) return;
    this.publish();
  }

  /** A text edit to one pad: published only if it moves the pad in the list or refreshes its label. */
  edit(id: string, transition: (state: PadState) => PadState): void {
    const previous = this.state;
    if (!this.commit(transition)) return;
    if (editChangesListing(previous, this.state, id, Date.now())) this.publish();
  }

  /** Returns false when nothing could be saved (storage blocked or over quota). */
  save(): boolean {
    return saveState(this.storage, this.state);
  }

  private commit(transition: (state: PadState) => PadState): boolean {
    const next = transition(this.state);
    if (next === this.state) return false;
    this.state = next;
    for (const listener of this.changeListeners) listener();
    return true;
  }

  private publish(): void {
    this.snapshot = this.state;
    for (const listener of this.subscribers) listener();
  }
}

function editChangesListing(previous: PadState, next: PadState, id: string, now: number): boolean {
  const before = previous.pads.find((pad) => pad.id === id);
  const after = next.pads.find((pad) => pad.id === id);
  if (!before || !after) return true;
  const movesToTop = sortedByRecent(previous.pads)[0].id !== id;
  return movesToTop || formatUpdated(before.updatedAt, now) !== formatUpdated(after.updatedAt, now);
}
