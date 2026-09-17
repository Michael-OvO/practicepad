import type { ResolvedTheme } from "../theme/theme";
import { MoonIcon, PadsIcon, SunIcon } from "./icons";

interface ActivityRailProps {
  padsOpen: boolean;
  theme: ResolvedTheme;
  onTogglePads(): void;
  onToggleTheme(): void;
}

/** The narrow icon rail on the far left, as in CoderPad's pad view. */
export function ActivityRail({ padsOpen, theme, onTogglePads, onToggleTheme }: ActivityRailProps) {
  return (
    <nav className="rail" aria-label="Workspace">
      <button
        type="button"
        className="rail-button"
        aria-label="Pads"
        aria-pressed={padsOpen}
        title={padsOpen ? "Hide pads" : "Show pads"}
        onClick={onTogglePads}
      >
        <PadsIcon />
      </button>
      <div className="rail-spacer" />
      <button
        type="button"
        className="rail-button"
        aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        onClick={onToggleTheme}
      >
        {theme === "dark" ? <SunIcon /> : <MoonIcon />}
      </button>
    </nav>
  );
}
