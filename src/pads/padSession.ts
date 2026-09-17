import { loadState, saveState, type PadState } from "./padStore";

type PadStorage = Pick<Storage, "getItem" | "setItem"> | null;

/**
 * Holds the pads outside React so the latest state can always be read synchronously.
 *
 * React applies state updates asynchronously. Anything that must see the very last keystroke
 * (saving while the tab closes, running code right after typing) would otherwise read a
 * snapshot from before the most recent render.
 */
export class PadSession {
  private readonly storage: PadStorage;
  private state: PadState;
  private readonly listeners = new Set<() => void>();

  constructor(storage: PadStorage) {
    this.storage = storage;
    this.state = loadState(storage);
  }

  // Arrow properties so they can be handed straight to useSyncExternalStore.
  getState = (): PadState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  apply(transition: (state: PadState) => PadState): void {
    const next = transition(this.state);
    if (next === this.state) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  /** Returns false when nothing could be saved (storage blocked or over quota). */
  save(): boolean {
    return saveState(this.storage, this.state);
  }
}
