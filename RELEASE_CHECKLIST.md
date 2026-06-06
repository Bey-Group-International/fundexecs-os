# FundExecs OS — Release Checklist

Target: **private beta (invite-only)**. Legend: ✅ done · 🟡 in progress / needs
verification · ⬜ not started. Owner: **Claude** (code/docs in-repo) vs **You**
(dashboard/external setup that can't be done from the repo).

---

## 1. Platform & build

- ✅ Site live: `www.fundexecs.com` + apex `fundexecs.com`, production deploy READY
- ✅ `main` green (format / typecheck / lint / build), no open PRs, no conflicts
- ✅ `package-lock.json` committed; CI on every push
- ✅ Landing renders (hero, The Team, Chain of Trust, Sign in)

## 2. Database (Supabase)

- ✅ RLS on all tables; 0 WARN-level performance advisors
- ✅ Security advisors resolved except the items below
- ✅ **Leaked-password protection** — enabled (advisor WARN cleared)
- ⬜ **Full `database.types.ts` regen** — _Claude_: needs a `SUPABASE_ACCESS_TOKEN`
  to drop the remaining casts (low priority; cosmetic)

## 3. Auth

- ✅ Google sign-in working (scopes: `calendar.readonly`, `gmail.metadata`)
- ✅ Email/password sign-in + signup
- 🟡 **Custom SMTP** — _You_: for a private beta the built-in Supabase mailer is
  usually fine; switch to custom SMTP (Resend/Postmark/SES) before opening
  signup more widely (built-in sender is rate-limited)
- 🟡 **Google consent screen** — _You_: only required to be verified if Google
  sign-in is opened beyond `@beygroupintl.com` / test users. Privacy policy
  URL is now live at `/privacy` for when you submit.

## 4. Integrations (config-driven; cards self-upgrade from "Coming soon")

- ✅ Backend wired end-to-end for all 8 providers (#56/#59)
- ✅ UI gates each card on server-side config (no broken buttons)
- ✅ **Slack** — secrets in Vercel + redirect URI registered
  (`https://www.fundexecs.com/api/integrations/slack/callback`)
- ✅ **Calendly** — secrets in Vercel + redirect URI registered
  (`https://www.fundexecs.com/api/integrations/calendly/callback`)
- ✅ **Gmail / Google Calendar** — live via Google sign-in scopes
- ✅ **Apollo** — live (API key entered in the UI)
- 🟡 **Google Drive / Docs / Slides** — show "Coming soon". To enable later:
  add `drive.readonly` to the sign-in scopes + complete Google verification

## 5. Legal / compliance

- ✅ **Privacy Policy** at `/privacy` (linked from landing + legal footer)
- ✅ **Terms of Service** at `/terms`
- 🟡 **Legal review** — _You_: these are solid starting drafts; have counsel
  confirm the operating-entity name ("FundExecs Technologies") and contents
- 🟡 **Contact inboxes** — _You_: ensure `privacy@fundexecs.com` /
  `legal@fundexecs.com` deliver mail

## 6. Hygiene

- ✅ `.env.example` synced with all required vars (Supabase, AI, integrations,
  test provisioning)
- 🟡 **Stale branches** — _You_: delete merged `emergent/main`,
  `codex/integrations`, and old `claude/*` branches via the GitHub UI
- ✅ No secrets in the repo (test credentials gitignored; password via env)

## 7. Post-beta backlog (not blockers)

- ⬜ Role-based access beyond member-type (fund / LP / operator / …)
- ⬜ AI Copilot Task Manager; Private-Market Lifecycle Intelligence; Bey Group
  Admin Portal
- ⬜ Durable OAuth token refresh for background sync
- ⬜ Re-embed the brains corpus (Voyage) after integration data lands

---

_Technical gating items are DONE. Remaining to launch private beta: confirm the
`privacy@` / `legal@` inboxes deliver and (optionally) have the legal drafts
reviewed (§5), then smoke-test a live Slack/Calendly connect. Everything else is
post-beta._
