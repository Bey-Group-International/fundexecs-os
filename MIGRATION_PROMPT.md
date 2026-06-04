# Claude Code — Migration Prompt: Unify onto FundExecs OS

Paste the block below into Claude Code with the `design_handoff_fundexecs_os/` folder
present in the repo. It directs Claude Code to remove the old, inconsistent site
components and rebuild every surface against the FundExecs OS design system — one
unified shell, one token set, one set of interaction patterns.

> **Note:** This is the _migration / consolidation_ prompt (for an existing app).
> For a from-scratch build, use `design_handoff_fundexecs_os/KICKOFF_PROMPT.md` instead.

---

## ▶ Migration Prompt (paste this)

> You are unifying an existing Next.js (App Router) + React 19 + Tailwind v4 + Supabase
> app onto the FundExecs OS design system. The single source of truth is the
> `design_handoff_fundexecs_os/` folder in this repo. Your job is to remove the old,
> inconsistent site components and rebuild every surface to match this system — one
> unified shell, one token set, one set of interaction patterns.
>
> ### Phase 0 — Orient (read before touching anything)
>
> 1. Read `design_handoff_fundexecs_os/README.md` end to end (screens, tokens, state model).
> 2. Read `design_handoff_fundexecs_os/KICKOFF_PROMPT.md` for the visual orientation + hard rules.
> 3. Open every image in `design_handoff_fundexecs_os/screenshots/` — these are the visual target.
> 4. Read `design_handoff_fundexecs_os/colors_and_type.css` — every token lives here.
>
> ### Phase 1 — Inventory, then plan (do NOT delete yet)
>
> - Map the current app: routes/pages, every reusable component, global styles, and any
>   ad-hoc/duplicated UI ("old site components").
> - Classify each as: REPLACE (rebuild on the new system), KEEP (already conformant or
>   non-UI logic like data/auth that works), or REMOVE (dead/orphaned).
> - Produce a short migration plan: the new shared shell, the token layer, and the order
>   you'll migrate screens. Show me this plan and WAIT for my approval before deleting code.
>
> ### Phase 2 — Foundation
>
> - Port `colors_and_type.css` into Tailwind v4 `@theme` variables. Never hardcode hex —
>   everything references tokens. Wire the `data-theme="light"` override + topbar toggle
>   persisting to `localStorage('fx-theme')`.
> - Build ONE app shell: left sidebar (244px: brand + org switcher + nav + user footer),
>   sticky topbar (title, search, theme toggle, gold Earn coin wallet, notifications bell),
>   fluid workspace with a centered 1180px max content column, and the floating circular
>   gold Earn orb (bottom-right) that opens the Copilot dock. All screens mount in this shell.
>
> ### Phase 3 — Migrate screen by screen (replace, verify, THEN remove the old)
>
> For each screen, rebuild to match its screenshot, wire state per the README's Supabase
> model, then delete the legacy components it replaced once nothing else imports them.
> Order: Auth/onboarding → Command Center (flagship, match 01-command-center.png closely)
> → Ask Earn → Pipeline → Strategy → Notifications → Chain of Trust (ambient toast layer +
> detail drawer) → Admin + Knowledge Base → Profile/Settings → mobile responsive shell.
>
> ### Phase 4 — Unify functionality (not just looks)
>
> Make these patterns consistent everywhere, replacing one-off implementations:
>
> - Notification/task/objective cards share one state model (read/archived/closed/deleted).
> - `window.emitTrust(...)` Chain-of-Trust toasts fire on completion; clicking opens the drawer.
> - The Earn orb + Copilot dock + brain switcher behave identically across screens.
> - Theme toggle, search, and the Earn wallet are shell-level, not per-page.
>
> ### Hard rules (enforce on every component)
>
> - Dark theme is primary (base #070b14, white-alpha surfaces, hairline borders).
> - Primary CTAs = institutional blue #2563EB (gradient + soft glow). Gold #F7C948 is
>   reserved for Earn + gamification ONLY — never decorative.
> - Geist / Geist Mono; Lucide icons only (~1.9px stroke, no emoji).
> - rounded-2xl (16px) cards, rounded-xl (12px) inputs/buttons/chips, pill badges.
> - Never transition `color` (theme-flip robustness). Entrance animations animate
>   transform only — visible end-state is the base.
> - Keep components small and idiomatic. Tabular figures for all metrics.
>
> ### Process guardrails
>
> - Work in small, verifiable steps. Run the build + lint after each screen; don't proceed
>   on a broken build.
> - Never delete a component that's still imported elsewhere until its replacement is wired in.
> - Ask me before inventing any screen, route, or content not in the handoff.
> - Don't refactor working data/auth/Supabase logic unless it's required to wire a screen.
>
> Assumption: this is the `fundexecs-os` repo the handoff targets. If the stack or folder
> location differs, tell me before Phase 1.

---

## Before you paste — check two things

1. **Folder location.** This prompt assumes `design_handoff_fundexecs_os/` is committed
   into the repo where Claude Code runs (that's how it reads the screenshots and CSS).
   If it lives elsewhere, update the paths in Phase 0.
2. **Approval gate.** Phase 1 stops for your sign-off before any deletion. To let Claude
   Code run end-to-end without checking in, remove the "WAIT for my approval" line —
   but keeping it is safer for the first run.
