"use client";

import { deleteDocument } from "./materials-actions";

export function DeleteDocumentButton({ id, name }: { id: string; name: string }) {
  return (
    <form
      action={deleteDocument}
      onSubmit={(event) => {
        if (!confirm(`Delete "${name}" permanently?`)) event.preventDefault();
      }}
      className="shrink-0"
    >
      <input type="hidden" name="id" value={id} />
      <button className="rounded-md border border-status-danger/40 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-status-danger transition hover:bg-status-danger/10">
        Delete
      </button>
    </form>
  );
}
