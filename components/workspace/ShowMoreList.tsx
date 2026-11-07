"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * A list that shows its first few rows and the rest on request.
 *
 * The rows are built by the caller (they are server-rendered cards), so this only
 * decides how many to show. When there are no more than `initial` rows it is just
 * the list, with no button.
 */
export function ShowMoreList({
  items,
  initial = 10,
  noun = "sessions",
  className = "flex flex-col gap-1.5",
}: {
  items: ReactNode[];
  /** How many rows to show before "Show all". */
  initial?: number;
  /** Plural noun for the button, e.g. "Show all 37 sessions". */
  noun?: string;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const overflow = items.length > initial;
  const shown = expanded || !overflow ? items : items.slice(0, initial);

  return (
    <div>
      <div id={listId} className={className}>
        {shown}
      </div>
      {overflow ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={listId}
          className="fx-action-link mt-2"
        >
          {expanded ? `Show fewer ${noun}` : `Show all ${items.length} ${noun}`}
        </button>
      ) : null}
    </div>
  );
}
