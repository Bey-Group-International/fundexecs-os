# Claude Code — Kickoff Prompt & Visual Orientation

Paste the **Kickoff Prompt** below into Claude Code (with this `design_handoff_fundexecs_os/` folder present in the repo). The **Visual Orientation** section underneath gives it the look-and-feel context so it builds in-brand from the first screen.

---

## ▶ Kickoff Prompt (paste this)

> You are building **FundExecs OS**, an AI-native private-market command center, in this Next.js (App Router) + React 19 + Tailwind v4 + Supabase repo.
>
> **Before writing any code, get visually oriented:**
> 1. Read `design_handoff_fundexecs_os/README.md` end to end — it specifies every screen, exact design tokens, interactions, and the state→Supabase mapping.
> 2. Open every image in `design_handoff_fundexecs_os/screenshots/` and study the layout, density, color, and typography. These are the visual target.
> 3. Port `design_handoff_fundexecs_os/colors_and_type.css` into Tailwind v4 `@theme` variables. Never hardcode hex — reference tokens.
>
> **Then implement, in this order:** (1) tokens + base layout shell (sidebar + topbar), (2) Auth + onboarding with email-domain routing, (3) Command Center (the flagship — match `01-command-center.png` closely), (4) Ask Earn, Pipeline, Strategy, Notifications, (5) Chain of Trust (ambient toasts + detail drawer), (6) Admin Portal + Knowledge Base, (7) Profile/Settings, (8) mobile responsive / app shell.
>
> **Hard rules:** dark theme primary (base `#070b14`, white-alpha surfaces, hairline borders); primary CTAs = institutional blue `#2563EB` (gradient + soft glow); **gold `#F7C948` only for Earn + gamification**; Geist / Geist Mono; Lucide icons (`lucide-react`, ~1.9px stroke, no emoji); the Earn coin mascot is always a circle; never transition `color`; entrance animations animate transform only. Earn is introduced as "Earnest Fundmaker, your Private Market Assistant," shorthand "Earn."
>
> Build each screen to match its screenshot, wire state to Supabase per the README's data model, and keep components small and idiomatic. Ask me before inventing any screen or content not in the handoff.

---

## 🎨 Visual Orientation (context for Claude Code)

**Overall feel.** A quiet, high-contrast operating system — not a CRM. Think Linear precision + Vercel restraint + Carta institutional finance. Near-monochrome dark canvas, generous whitespace, soft deep shadows with a 1px top highlight, smooth ~200ms easing.

**Layout skeleton (desktop).** Left **sidebar** 244px (brand + org switcher + nav + user footer) · sticky **topbar** (page title, search, theme toggle, gold **Earn coin wallet**, notifications bell) · fluid workspace with a centered **1180px** max content column · a floating **circular gold Earn orb** bottom-right that opens the Copilot dock.

**Color discipline.**
- Background depth comes from **white-alpha surfaces** (`rgba(255,255,255,.035→.085)`) on `#070b14`, with `rgba(255,255,255,.085)` hairline borders — *not* from solid grays.
- Text is a slate ramp: `#fff → #cbd5e1 → #94a3b8 → #64748b → #475569`.
- **Blue `#2563EB`** = primary actions, active nav, focus. **Gold `#F7C948`** = Earn identity, XP/coins, level/status badges, *nothing else*. Semantic chips (emerald/amber/rose/sky) are small tinted pills only.
- Chain-of-Trust layers are color-coded: Truth sky · Concept violet · Execution amber · Work emerald.

**Typography.** Geist semibold headings with tight negative tracking; 13–14px slate body at 1.6 line-height; ALL-CAPS 10.5px eyebrows tracked `.11em`; tabular figures for all metrics.

**Signature components.** `rounded-2xl` cards (16px) with soft shadow + hover lift; `rounded-xl` (12px) inputs/buttons/chips; pill badges; KPI cards with tiny tone-matched sparklines; the **Earn briefing** (glow-ringed coin + live status dot + ranked priority rows); ambient **Chain-of-Trust toasts** that open a right-side detail drawer.

**Light/day theme.** A `data-theme="light"` token set exists (white/slate surfaces, dark text, same blue+gold) toggled from the topbar — primarily for documents; dark stays the default.

**Mobile app.** Same dark system in Android + iOS frames; a 5-tab bottom bar with a **center gold Earn orb**: Home · Pipeline · Earn · Approvals · Alerts. See `02-mobile-android.png`, `10-mobile-ios.png`, `11-mobile-earn.png`.

**What "good" looks like.** If a screen feels like a dense CRM table dump, it's wrong. If it feels like a calm command console where Earn surfaces the next action and proof is one glance away — that's the target. Match the screenshots; when in doubt, prefer fewer elements, more hierarchy.
