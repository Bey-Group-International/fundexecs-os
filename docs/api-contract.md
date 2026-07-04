# FundExecs OS API Contract

FundExecs OS exposes native REST route handlers. There is no GraphQL surface in
the current application.

## Authenticated workflow API

These routes require the Supabase session cookie and an active organization.

| Route | Method | Purpose | Response shape |
| --- | --- | --- | --- |
| `/api/prompt` | `POST` | Create a planned workflow from a user prompt. | Engine result, `201` on create |
| `/api/task` | `GET` | List top-level workflows for the active organization. | `{ workflows, nextCursor }` |
| `/api/approve` | `POST` | Capture an approval decision and execute or reject the workflow. | Engine approval result |
| `/api/report` | `GET` | Read workflow output and artifacts. | Report payload or `{ error }` |
| `/api/agents` | `GET` | List agent catalog and workload state. | Agent workload payload |
| `/api/graph/[graph]` | `GET` | Read the relationship, deal, or capital graph. | Graph payload |

Handoff packets are generated and persisted internally by `lib/handoff.ts`; they
are not exposed as a standalone public route.

## External v1 API

These routes require a FundExecs API key.

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/v1` | `GET` | API index and available resources. |
| `/api/v1/whoami` | `GET` | Identify the API key and organization. |
| `/api/v1/organization` | `GET` | Read organization metadata. |
| `/api/v1/deals` | `GET` | Cursor-paginated deal list. |
| `/api/v1/funds` | `GET` | Cursor-paginated fund list. |
| `/api/v1/investors` | `GET` | Cursor-paginated investor list. |

## Error contract

Routes return `{ error: string }` with the appropriate HTTP status for
authentication, validation, and server failures.
