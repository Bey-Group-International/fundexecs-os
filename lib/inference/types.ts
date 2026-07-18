// lib/inference/types.ts
// The provider-agnostic inference gateway — types. A skill or workflow step
// requests a CAPABILITY (and optional constraints: data sensitivity, region,
// context size, cost/latency preference), NOT a model. The router picks a model,
// a provider executes it, and the gateway returns the text plus telemetry
// (provider, model, tokens, latency). Anthropic/OpenAI/Google/local models are
// interchangeable providers behind this seam — never the product itself.
//
// Pure types + a couple of pure helpers; the router is pure and unit-tested.

/** What a caller needs from a model, independent of any vendor. */
export type InferenceCapability =
  | "long_context"
  | "structured_extraction"
  | "financial_reasoning"
  | "tool_use"
  | "spreadsheet_generation"
  | "image_understanding"
  | "low_latency_classification"
  | "high_assurance_review"
  | "private_deployment";

export type ModelTier = "fast" | "balanced" | "high_assurance";

/** Classification of the data in the request — drives residency/provider rules. */
export type DataSensitivity = "public" | "internal" | "restricted";

/** A model a provider can serve, with the capabilities + constraints it satisfies. */
export interface ModelSpec {
  id: string;
  provider: string;
  tier: ModelTier;
  capabilities: InferenceCapability[];
  contextTokens: number;
  costPer1kInput?: number;
  costPer1kOutput?: number;
  /** Regions this model may process data in. Undefined = unrestricted. */
  regions?: string[];
  /** True when the model runs in a private/self-hosted deployment. */
  privateDeployment?: boolean;
}

export interface InferenceMessage {
  role: "user" | "assistant";
  content: string;
}

export interface InferenceRequest {
  system?: string;
  messages: InferenceMessage[];
  capability?: InferenceCapability;
  maxTokens?: number;
  temperature?: number;
  sensitivity?: DataSensitivity;
  region?: string;
  /** Estimated context size, for routing against a model's window. */
  contextTokens?: number;
  preferTier?: ModelTier;
  costCeilingPer1kOutput?: number;
  /** Pin a specific model id, bypassing capability routing. */
  model?: string;
}

export interface InferenceUsage {
  inputTokens: number;
  outputTokens: number;
}

/** The gateway result — text plus the telemetry a run ledger records. */
export interface InferenceResult {
  ok: boolean;
  text: string | null;
  provider: string | null;
  model: string | null;
  usage: InferenceUsage;
  latencyMs: number;
  /** True when no provider/model could serve the request (caller falls back). */
  degraded: boolean;
  error?: string;
}

/** The one interface every inference provider implements. */
export interface InferenceProvider {
  key: string;
  label: string;
  /** True when this provider can actually be called (creds present). */
  available(): boolean;
  /** The models this provider can currently serve. */
  models(): ModelSpec[];
  /** Execute a completion on a specific model. Returns text + usage; never throws. */
  complete(modelId: string, req: InferenceRequest): Promise<{ text: string | null; usage: InferenceUsage }>;
}

/** The routing inputs (a subset of a request). */
export interface RoutePolicy {
  capability?: InferenceCapability;
  sensitivity?: DataSensitivity;
  region?: string;
  contextTokens?: number;
  preferTier?: ModelTier;
  costCeilingPer1kOutput?: number;
}

export interface RouteDecision {
  provider: string;
  model: ModelSpec;
  reason: string;
}

/** A provider's routable surface (what the pure router reasons over). */
export interface RoutableProvider {
  key: string;
  available: boolean;
  models: ModelSpec[];
}
