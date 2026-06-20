"use client";

import { deleteSession } from "@/app/(app)/sessions/actions";

// Permanent delete for a session, surfaced on the Command Center. The confirm
// lives here (client) so the destructive action can't fire by accident;
// `no_redirect` keeps the operator on the dashboard instead of bouncing to
// /workspace the way an in-session delete does.
export function DeleteSessionButton({ id }: { id: string }) {
  return (
    <form
      action={deleteSession}
      onSubmit={(e) => {
        if (!confirm("Delete this session permanently? This removes all its data.")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="no_redirect" value="true" />
      <button
        title="Delete permanently"
        className="rounded-md border border-line px-1.5 py-1 text-[10px] text-fg-muted transition hover:border-status-danger/50 hover:text-status-danger"
      >
        Delete
      </button>
    </form>
  );
}
