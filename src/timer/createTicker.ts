/**
 * Calls `onTick` every `intervalMs` until the returned function is called.
 *
 * Ticks come from a worker because browsers throttle a hidden tab's own timers, down to once a
 * minute, and a hidden tab is exactly where the countdown in the tab title gets read. Falls
 * back to a plain interval where workers are unavailable.
 */
export function createTicker(onTick: () => void, intervalMs: number): () => void {
  let stopped = false;
  let release = () => {};

  const useInterval = () => {
    if (stopped) return;
    const interval = window.setInterval(onTick, intervalMs);
    release = () => window.clearInterval(interval);
  };

  try {
    const worker = new Worker(new URL("./tick.worker.ts", import.meta.url), { type: "module" });
    release = () => worker.terminate();
    worker.onmessage = onTick;
    worker.onerror = (event) => {
      event.preventDefault();
      worker.terminate();
      useInterval();
    };
    worker.postMessage(intervalMs);
  } catch {
    useInterval();
  }

  return () => {
    stopped = true;
    release();
  };
}
