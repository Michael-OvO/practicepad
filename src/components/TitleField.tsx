import { useRef, useState } from "react";

interface TitleFieldProps {
  id?: string;
  title: string;
  ariaLabel: string;
  className: string;
  autoFocus?: boolean;
  onCommit(title: string): void;
  onDone?(): void;
}

/** Inline text field for a pad title: Enter or blur commits, Escape cancels. */
export function TitleField({ id, title, ariaLabel, className, autoFocus = false, onCommit, onDone }: TitleFieldProps) {
  const [draft, setDraft] = useState(title);
  const cancelled = useRef(false);

  const finish = () => {
    const next = draft.trim();
    if (!cancelled.current && next !== "" && next !== title) onCommit(next);
    else setDraft(title);
    cancelled.current = false;
    onDone?.();
  };

  return (
    <input
      id={id}
      className={className}
      aria-label={ariaLabel}
      value={draft}
      autoFocus={autoFocus}
      spellCheck={false}
      onFocus={(event) => {
        if (autoFocus) event.currentTarget.select();
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          cancelled.current = true;
          event.currentTarget.blur();
        }
      }}
    />
  );
}
