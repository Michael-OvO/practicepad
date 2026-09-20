const isApple = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Shortcut labels: Cmd on Apple platforms, Ctrl elsewhere. */
export const RUN_SHORTCUT_LABEL = isApple ? "⌘↵" : "Ctrl+↵";
export const RUN_TESTS_SHORTCUT_LABEL = isApple ? "⇧⌘↵" : "Ctrl+Shift+↵";
export const PALETTE_SHORTCUT_LABEL = isApple ? "⌘K" : "Ctrl+K";
