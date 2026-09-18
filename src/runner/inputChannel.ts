/**
 * One line of stdin, handed from the page to the Python worker through shared memory.
 *
 * Python reads stdin synchronously, so the worker has to block until the user has typed a
 * line. It waits on the state word with Atomics.wait; the page fills the buffer and notifies.
 *
 * Layout (Int32 header, then bytes):
 *   byte 0  state   0 empty, 1 a line is ready, 2 end-of-file
 *   byte 4  length  UTF-8 byte length of the line
 *   byte 8… the line, without its newline
 */
export const INPUT_CHANNEL_BYTES = 64 * 1024;

const STATE = 0;
const LENGTH = 1;
const HEADER_BYTES = 8;

const EMPTY = 0;
const LINE = 1;
const EOF = 2;

/** Null on a page that is not cross-origin isolated: browsers hide SharedArrayBuffer there. */
export function createInputChannel(): SharedArrayBuffer | null {
  if (typeof SharedArrayBuffer !== "function") return null;
  return new SharedArrayBuffer(INPUT_CHANNEL_BYTES);
}

// Browsers refuse to encode into, or decode from, shared memory directly, so the text goes
// through a private buffer of the same size on either side.
const CAPACITY = INPUT_CHANNEL_BYTES - HEADER_BYTES;

export function writeLine(channel: SharedArrayBuffer, text: string): void {
  const header = new Int32Array(channel);
  const scratch = new Uint8Array(CAPACITY);
  // encodeInto never writes a partial character, so a cut line is still valid UTF-8.
  const { written } = new TextEncoder().encodeInto(text, scratch);
  new Uint8Array(channel, HEADER_BYTES).set(scratch.subarray(0, written));
  Atomics.store(header, LENGTH, written);
  Atomics.store(header, STATE, LINE);
  Atomics.notify(header, STATE);
}

export function writeEof(channel: SharedArrayBuffer): void {
  const header = new Int32Array(channel);
  Atomics.store(header, LENGTH, 0);
  Atomics.store(header, STATE, EOF);
  Atomics.notify(header, STATE);
}

/** Blocks until the page has written a line or EOF. Only for workers: pages cannot wait. */
export function readLine(channel: SharedArrayBuffer): string | null {
  const header = new Int32Array(channel);
  Atomics.wait(header, STATE, EMPTY);
  const state = Atomics.load(header, STATE);
  const length = Atomics.load(header, LENGTH);
  let text: string | null = null;
  if (state === LINE) {
    const copy = new Uint8Array(length);
    copy.set(new Uint8Array(channel, HEADER_BYTES, length));
    text = new TextDecoder().decode(copy);
  }
  Atomics.store(header, STATE, EMPTY);
  return text;
}
