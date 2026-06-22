// WebSocket / Realtime event model. These types describe the payloads emitted
// as the task engine runs and consumed by the live workspace. They correspond
// to rows in the `task_events` table (the durable record behind Realtime).
import type { AgentKey, Hub, GraphKind, ArtifactType } from "./supabase/database.types";

export type TaskEventType =
  | "task.created"
  | "task.progress"
  | "task.completed"
  | "task.handoff"
  | "approval.requested"
  | "approval.response"
  | "artifact.created"
  | "artifact.verified"
  | "artifact.sealed"
  | "graph.update";

interface BaseEvent {
  event: TaskEventType;
  organization_id: string;
  task_id: string | null;
  agent?: AgentKey;
  hub?: Hub;
  timestamp: string;
}

export interface TaskCreatedEvent extends BaseEvent {
  event: "task.created";
  title: string;
}

export interface TaskProgressEvent extends BaseEvent {
  event: "task.progress";
  progress: number; // 0..1
  message?: string;
}

export interface TaskCompletedEvent extends BaseEvent {
  event: "task.completed";
  message?: string;
}

export interface TaskHandoffEvent extends BaseEvent {
  event: "task.handoff";
  from_agent: AgentKey | null;
  to_agent: AgentKey;
  reason?: string;
}

export interface ApprovalRequestedEvent extends BaseEvent {
  event: "approval.requested";
  approval_id: string;
  summary: string;
}

export interface ApprovalResponseEvent extends BaseEvent {
  event: "approval.response";
  approval_id: string;
  decision: "approved" | "rejected" | "regenerate";
}

export interface ArtifactCreatedEvent extends BaseEvent {
  event: "artifact.created";
  artifact_id: string;
  artifact_type: ArtifactType;
  title: string;
  // Trust layer: how many grounding citations were attached to the artifact.
  sources?: number;
}

// Trust layer: an operator's approval signed off an artifact — the badge flips
// from Grounded/Unverified to Verified.
export interface ArtifactVerifiedEvent extends BaseEvent {
  event: "artifact.verified";
  artifact_id: string;
  artifact_type: ArtifactType;
}

// Trust layer (phase 3.1): a verified artifact was sealed into the attestations
// rail — its content + sources + verification decision are now provable via an
// immutable evidence_hash. `attestation_id` points at the sealing row.
export interface ArtifactSealedEvent extends BaseEvent {
  event: "artifact.sealed";
  artifact_id: string;
  attestation_id: string;
  evidence_hash: string;
}

export interface GraphUpdateEvent extends BaseEvent {
  event: "graph.update";
  graph: GraphKind;
}

export type FundExecsEvent =
  | TaskCreatedEvent
  | TaskProgressEvent
  | TaskCompletedEvent
  | TaskHandoffEvent
  | ApprovalRequestedEvent
  | ApprovalResponseEvent
  | ArtifactCreatedEvent
  | ArtifactVerifiedEvent
  | ArtifactSealedEvent
  | GraphUpdateEvent;
