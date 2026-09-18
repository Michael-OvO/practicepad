// Typed by hand: the DOM and WebWorker TypeScript libs conflict when both are loaded.
const ctx = self as unknown as {
  postMessage(message: null): void;
  onmessage: ((event: MessageEvent<number>) => void) | null;
};

// The page sends the interval once; every tick after that is an empty message back.
ctx.onmessage = (event) => {
  setInterval(() => ctx.postMessage(null), event.data);
};
