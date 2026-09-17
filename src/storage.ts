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
