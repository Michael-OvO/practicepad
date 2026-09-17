import type { ReactNode } from "react";
import { PALETTE_SHORTCUT_LABEL } from "../platform";
import { BrandMark, SearchIcon } from "./icons";
import { TitleField } from "./TitleField";

interface TopBarProps {
  padId: string;
  title: string;
  timer: ReactNode;
  onRename(title: string): void;
  onOpenPalette(): void;
}

export const PAD_TITLE_INPUT_ID = "pad-title";

export function TopBar({ padId, title, timer, onRename, onOpenPalette }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <BrandMark />
        <span className="brand-name">PracticePad</span>
      </div>
      <span className="topbar-divider" aria-hidden="true" />
      {/* Keyed so the draft resets when the pad or its saved title changes. */}
      <TitleField
        key={`${padId}:${title}`}
        id={PAD_TITLE_INPUT_ID}
        title={title}
        ariaLabel="Pad title"
        className="title-input"
        onCommit={onRename}
      />
      <div className="topbar-spacer" />
      {timer}
      {/* Looks like a search field so the palette is discoverable without knowing the shortcut. */}
      <button type="button" className="palette-trigger" aria-label="Open command palette" onClick={onOpenPalette}>
        <SearchIcon />
        <span className="palette-trigger-text">Search commands</span>
        <kbd className="keycap" aria-hidden="true">
          {PALETTE_SHORTCUT_LABEL}
        </kbd>
      </button>
    </header>
  );
}
