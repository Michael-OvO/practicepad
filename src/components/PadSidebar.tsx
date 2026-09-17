import { useState } from "react";
import { formatUpdated } from "../pads/formatUpdated";
import { sortedByRecent, type Pad } from "../pads/padStore";
import { PencilIcon, PlusIcon, TrashIcon } from "./icons";
import { TitleField } from "./TitleField";

interface PadSidebarProps {
  pads: Pad[];
  activeId: string;
  onCreate(): void;
  onSelect(id: string): void;
  onRename(id: string, title: string): void;
  onDelete(id: string): void;
}

export function PadSidebar({ pads, activeId, onCreate, onSelect, onRename, onDelete }: PadSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const now = Date.now();

  return (
    <aside className="sidebar" aria-label="Pads">
      <div className="sidebar-header">
        <span>Pads</span>
        <button type="button" className="icon-button" aria-label="New pad" title="New pad" onClick={onCreate}>
          <PlusIcon />
        </button>
      </div>
      <ul className="pad-list">
        {sortedByRecent(pads).map((pad) => (
          <li key={pad.id} className={`pad-item${pad.id === activeId ? " is-active" : ""}`}>
            {editingId === pad.id ? (
              <TitleField
                title={pad.title}
                ariaLabel={`Rename ${pad.title}`}
                className="pad-rename"
                autoFocus
                onCommit={(title) => onRename(pad.id, title)}
                onDone={() => setEditingId(null)}
              />
            ) : (
              <>
                <button
                  type="button"
                  className="pad-select"
                  aria-current={pad.id === activeId ? "true" : undefined}
                  onClick={() => onSelect(pad.id)}
                >
                  <span className="pad-title">{pad.title}</span>
                  <span className="pad-meta">Edited {formatUpdated(pad.updatedAt, now)}</span>
                </button>
                <div className="pad-actions">
                  <button type="button" className="icon-button" aria-label={`Rename ${pad.title}`} onClick={() => setEditingId(pad.id)}>
                    <PencilIcon />
                  </button>
                  <button
                    type="button"
                    className="icon-button is-danger"
                    aria-label={`Delete ${pad.title}`}
                    onClick={() => {
                      if (window.confirm(`Delete "${pad.title}"? This can't be undone.`)) onDelete(pad.id);
                    }}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}
