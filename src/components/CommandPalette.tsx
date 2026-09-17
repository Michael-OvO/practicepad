import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { searchCommands, type Command } from "../commands/commandSearch";
import { SearchIcon } from "./icons";

interface CommandPaletteProps {
  open: boolean;
  commands: Command[];
  onClose(): void;
}

/**
 * Cmd/Ctrl+K palette. A native modal <dialog> gives it a focus trap, Escape to close, and
 * focus restoration to wherever the user was (usually the editor) for free.
 */
export function CommandPalette({ open, commands, onClose }: CommandPaletteProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="palette"
      aria-label="Command palette"
      onClose={onClose}
      onClick={(event) => {
        // The dialog element itself is only hit when the click lands on the backdrop.
        if (event.target === dialogRef.current) onClose();
      }}
    >
      {/* Mounted per opening, so the query and selection start fresh each time. */}
      {open && <PaletteBody commands={commands} onClose={onClose} />}
    </dialog>
  );
}

function PaletteBody({ commands, onClose }: { commands: Command[]; onClose(): void }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const results = useMemo(() => searchCommands(commands, query), [commands, query]);
  const active = results[Math.min(activeIndex, results.length - 1)];
  const showSections = query.trim() === "";

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const execute = (command: Command) => {
    onClose();
    // Let the dialog close and hand focus back first, so commands that move focus win.
    window.setTimeout(() => command.run(), 0);
  };

  const move = (delta: number) => {
    if (results.length === 0) return;
    const current = Math.min(activeIndex, results.length - 1);
    setActiveIndex((current + delta + results.length) % results.length);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(Math.max(0, results.length - 1));
        break;
      case "Enter":
        event.preventDefault();
        if (active) execute(active);
        break;
    }
  };

  return (
    <div className="palette-body">
      <div className="palette-search">
        <SearchIcon />
        <input
          autoFocus
          className="palette-input"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={active ? `palette-option-${active.id}` : undefined}
          aria-label="Search commands"
          placeholder="Type a command or a pad name"
          spellCheck={false}
          autoComplete="off"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
        />
        <kbd className="keycap">esc</kbd>
      </div>

      {results.length === 0 ? (
        <p className="palette-empty">No commands match “{query.trim()}”.</p>
      ) : (
        <ul id="palette-list" className="palette-list" role="listbox" aria-label="Commands" ref={listRef}>
          {results.map((command, index) => {
            const startsSection = showSections && (index === 0 || results[index - 1].section !== command.section);
            return (
              <li key={command.id} role="presentation">
                {startsSection && (
                  <div className="palette-section" role="presentation">
                    {command.section}
                  </div>
                )}
                <div
                  id={`palette-option-${command.id}`}
                  className="palette-option"
                  role="option"
                  aria-selected={command === active}
                  onPointerMove={() => setActiveIndex(index)}
                  onClick={() => execute(command)}
                >
                  <span className="palette-title">{command.title}</span>
                  {command.shortcut && <kbd className="keycap">{command.shortcut}</kbd>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
