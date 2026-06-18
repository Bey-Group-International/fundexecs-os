# FundExecs OS — Investor Demo Runbook

A 5-minute walkthrough that shows the differentiator: **AI agents that own the
work**, on top of an approval-gated operating system for private capital.

> The app also ships an in-product **Guided Tour** (floating, bottom-right) that
> mirrors this script step-for-step. Use it live so the audience follows along.

---

## 1. Pre-demo setup (do this once, before the meeting)

**Environment variables** (Vercel project → Settings → Environment Variables):

| Variable | Needed for | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the app | already set |
| `SUPABASE_SERVICE_ROLE_KEY` | scheduled automations (`/api/cron`) | server-only |
| `ANTHROPIC_API_KEY` | the live Copilot loop | already set |
| `CLAUDE_MODEL` | optional model override | defaults to `claude-haiku-4-5-20251001` (cheap) |
| `CRON_SECRET` | guards `/api/cron` | required for scheduled runs; "Run now" works without it |

**Google sign-in** (Supabase → Authentication → Providers → Google): paste the
Google **Client ID** and **Client Secret**, and add the redirect URLs:
`https://<your-domain>/auth/callback` and the Vercel preview URL's `/auth/callback`.
The secret lives only in Supabase — never in the repo.

**Seed the demo:** sign in → **Command Center** → **Load demo data**. The
dashboard, pipeline, deliverables, and a sample automation populate instantly.
(Use **Reset** to clear between runs.)

---

## 2. The 5-minute script

1. **Land on the marketing page.** One line: *"PE funds run on 30+ tools. This
   is one AI-native OS — with six agents that own the work."* Point at the
   prompt → plan → approve → deliver loop.
2. **Sign in with Google** (one click) → Command Center, already populated.
   Talk to the deal pipeline, portfolio assets, and latest deliverables.
3. **Open the Copilot.** Type: *"Source multifamily targets in Texas under
   $50M."* The Associate plans it into ordered agent steps.
4. **Approve & automate.** Each agent executes and streams a real deliverable
   (IC memo, model, risk report). Emphasize: *nothing runs without approval.*
5. **Open Automations.** Show "Weekly pipeline digest" with its **next run**
   time. Hit **Run now** to demonstrate the same loop firing unattended. Land
   the line: *"Save an instruction once; trusted ones run on their own."*
6. **Back to the Command Center** — the new deal/deliverable is now there.
   *"The work the agents did is the system of record."*

---

## 3. Talking points

- **Differentiator:** like Tasklet, agents *own the work* — but purpose-built
  for private markets and **approval-gated by default** (opt-in autonomy).
- **Trust:** the operator is never bypassed; every run leaves an auditable
  artifact; org-scoped with row-level security.
- **Architecture:** one spine — `prompt → plan → (approval | auto-approve) →
  execute` — serves the Copilot, scheduled automations, and (next) email /
  webhook / event triggers and external integrations.

---

## 4. If something misbehaves

- **Copilot returns canned text** → `ANTHROPIC_API_KEY` missing; it's running
  the deterministic fallback. Set the key and redeploy.
- **Scheduled run didn't fire** → `CRON_SECRET` / `SUPABASE_SERVICE_ROLE_KEY`
  not set, or the hourly Vercel cron hasn't ticked yet. Use **Run now** to demo.
- **Google sign-in errors** → provider not enabled in Supabase, or the
  redirect URL isn't whitelisted. Fall back to email/password.
