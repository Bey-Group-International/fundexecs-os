// lib/inbox/action-labels.ts

import type { ActionKind } from "@/lib/gates";

/**
 * The words an inbox action's task is titled with ("Reply — Ana Diaz"). The
 * inbox titles tasks with them, and the approval path reads them back to
 * recover the action of a task queued before the action was parked on it.
 */
export const INBOX_ACTION_LABEL: Partial<Record<ActionKind, string>> = {
  send_reply: "Reply",
  propose_meeting: "Propose a time",
  confirm_booking: "Confirm booking",
  create_video_meeting: "Create meeting link",
  share_materials: "Share Command Center details",
};
