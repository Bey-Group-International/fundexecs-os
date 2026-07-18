# Provider-Agnostic Inference Gateway + Phase-0 Stabilization

**Status:** Landed, additive. The inference gateway is behind a flag
(`INFERENCE_GATEWAY_ENABLED`, off by default → current Anthropic path unchanged);
Phase-0 metric fixes are live.
**Scope:** two of the master program's non-negotiables — *"do not hard-code
Anthropic"* and *"do not display invented platform metrics."*

---

## Part A — Provider-agnostic inference gateway

### Problem (audited)

Every model call went through `lib/anthropic-client.ts`; "model switching" in the
UI only injected a persona hint (`lib/earn-conversation.ts`) — the executed model
was always Claude. There was no capability-based routing, no provider abstraction,
and no per-call telemetry.

### Design

A skill or workflow step requests a **capability** (and optional constraints —
data sensitivity, region, context size, tier/cost preference), **not a model**.
The gateway routes over the available providers and returns text + telemetry.

```
  runInference({ capability, sensitivity, region, contextTokens, preferTier, … })
        │
        ▼
  router.selectRoute(policy, routableProviders)   ← pure, tested
        │   hard filters: available · capability · restricted→private/region ·
        │                 region · context window · cost ceiling
        │   ranking: preferred tier → sensitivity-aware tier bias → cost → context
        ▼
  provider.complete(modelId, req)   ← anthropic (live); openai/google/local = add an adapter
        │
        ▼
  InferenceResult { text, provider, model, usage{in,out}, latencyMs, degraded }
```

- `lib/inference/types.ts` — capabilities, `ModelSpec`, request/result, the
  `InferenceProvider` interface, `RoutePolicy`.
- `lib/inference/router.ts` — **pure** capability router (10 tests): capability
  filter, restricted-data → private-deployment/region gate, region + context +
  cost filters, tier preference, deterministic tie-break.
- `lib/inference/anthropic.ts` — the first adapter. Reuses `anthropicClient()`
  (explicit timeouts, one retry) and mirrors `lib/brains/llm.ts` exactly (fast
  default model, effort only where supported, error → null). Declares three
  tiers (fast/balanced/high_assurance), each env-overridable.
- `lib/inference/registry.ts` — the provider seam.
- `lib/inference/gateway.ts` — `runInference` (route → execute → telemetry) +
  `inferenceConfigured()`. Degrades (never throws) when no provider/model
  qualifies, so every caller keeps its deterministic fallback.

### Integration (reversible proof)

`lib/brains/llm.ts complete()` routes through the gateway when
`INFERENCE_GATEWAY_ENABLED=true` (with `preferTier: "fast"` to preserve the Brain
default), else the existing direct Anthropic path runs unchanged. This proves the
seam end-to-end with zero default-behavior change.

### Adding a provider

Implement `InferenceProvider` (OpenAI/Google/local) and register it — no caller
changes. Restricted-data and region policies already route to private/regional
models when they exist.

### Backlog

- Route `lib/claude.ts`'s ~15 direct call sites through the gateway (per-call
  behind the flag), and persist telemetry to a dedicated `inference_runs` ledger
  (today telemetry rides on `InferenceResult`; `skill_runs` already has
  provider/model columns).
- Real OpenAI/Google adapters; structured-output routing; prompt-version tagging.

## Part B — Phase-0 stabilization (invented metrics)

The master prompt: *"Fix visible credibility defects… Do not display invented
platform metrics."*

- **Removed** the invented **"$2B+ private-market deal flow tracked"** counter
  and the **fabricated testimonial** ("Early-access fund operator") from
  `app/page.tsx`.
- **Kept only verifiable, derived facts:** "4 hubs" (Build · Source · Run ·
  Execute) and the executive count, now **derived from `AGENTS.length`**
  (`lib/agents.ts`) so it can never drift or misstate.
- **Fixed the zero-on-hydration defect** in `components/marketing/StatCounter.tsx`:
  the resting figure now *initializes to the real value* (correct on the server,
  at first paint, with JS disabled, and if the observer never fires); the count-up
  is a pure progressive enhancement that always lands exactly on the true value. A
  counter can no longer render as a stale `0`.

## Verification

15 new tests (router 10, gateway/registry 5); full suite **3077 green**, typecheck
+ eslint clean. Gateway integration and Phase-0 changes are additive and
flag-gated / content-only — no existing behavior changed by default.
