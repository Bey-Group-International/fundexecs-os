# Routing `lib/claude.ts` Through the Inference Gateway (flagged)

**Status:** Landed, additive, **default-OFF**. The workflow's free-text deliverable
generation (`executeStep`) can now run through the provider-agnostic inference
gateway instead of calling Anthropic directly — and each such call is recorded in
the `inference_runs` ledger. With the flag off (the default), the direct-Anthropic
path is byte-for-byte unchanged, and it remains the guaranteed fallback whenever
the gateway is disabled or degraded.

This is the last backend seam of the provider-abstraction workstream: it activates
the gateway (and its telemetry ledger) on the real LLM path, and it means a
non-Anthropic provider can serve the workflow without touching any call site.

---

## The seam

- **`CLAUDE_VIA_GATEWAY_ENABLED`** (`lib/claude.ts`, off unless `"true"`).
- **`tryGatewayText({ system, prompt, capability, maxTokens, purpose, ctx })`** —
  returns the completion text when the gateway is **enabled AND configured AND**
  returns a usable result; otherwise **null**, so the caller runs its existing
  direct-Anthropic path unchanged. Records telemetry via `runInferenceLogged` when
  an `orgId` is present (else `runInference`, unlogged). Never throws.
- **`executeStep`** builds its system + user prompt as before, then tries the
  gateway first; on null it falls to the direct `anthropic.messages.create` path
  (which itself falls back to the deterministic stub when no API key). The engine
  threads org/session/workflow context so a routed run is attributable in
  `inference_runs`.

## Why only `executeStep`

`executeStep` is the workflow's **free-text** deliverable generator (text in, text
out) — exactly what the gateway abstraction serves. The other `lib/claude.ts`
calls (`generatePlan`/`generatePlans`, `generateClarifyingQuestions`,
`earnFollowups`, `extractDealFields`/`extractAssetFields`/`extractOwnership`) rely
on Anthropic's **JSON-schema tool** (`output_config.format` / structured outputs)
to return guaranteed-parseable JSON. The gateway's request shape has no
structured-output channel yet, so routing those through it would break their
`JSON.parse`. They deliberately stay on the direct path until the gateway grows a
structured-output capability. `earnChatStream` stays direct too — the gateway is a
discrete request/response abstraction, not a token stream.

## Guarantees preserved

- **Default off** — the flag gates the entire gateway attempt; with it off,
  `tryGatewayText` returns null immediately and nothing changes.
- **Fallback always** — even with the flag on, a disabled/degraded/erroring
  gateway returns null and the direct-Anthropic path runs. No request is ever lost.
- **Never fabricate** — routing changes the transport, not the prompt; the same
  system + user content is sent, and the deterministic stub still covers no-key mode.

## Verification

`tsc` + eslint clean; full Jest suite **3678 green**. New tests assert the flag-off
default (`tryGatewayText` → null; `executeStep` unchanged deterministic fallback
with no key), no regressions.

## Remaining (follow-ups)

- Give the gateway a structured-output capability, then route the JSON-schema calls
  (plans, field extraction) through it too.
- Real OpenAI / Google provider adapters behind the gateway registry (the routing
  is now provider-agnostic; only the adapters are Anthropic-only today).
- Stream support in the gateway to route `earnChatStream`.

