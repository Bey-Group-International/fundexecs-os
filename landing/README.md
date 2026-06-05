# FundExecs — Marketing Landing Page

A **static**, self-contained marketing landing page for FundExecs.

- **No build step.** Just open `index.html` in a browser.
- **Tailwind via the Play CDN** with an inline `tailwind.config` (palette + fonts).
- **Vanilla JS** (no framework) in `js/`.
- **Completely independent of the Next.js app** in the repo root (`app/`,
  `components/`, `lib/`, …). Nothing here imports from or affects that app, and
  the app's CI ignores this folder (see "CI / repo hygiene" below).

## Run it locally

Open the file directly:

```
open landing/index.html        # macOS
xdg-open landing/index.html    # Linux
```

Or serve it (recommended, so the `fetch()` of `data/activity.json` works under
the same origin):

```
cd landing
python3 -m http.server 8080
# then visit http://localhost:8080
```

> If you open `index.html` via `file://` and the activity ticker shows
> "loading shortly", that's the browser blocking the local `fetch()`. Use the
> `http.server` command above — any static server works.

## File tree

```
landing/
├── index.html            # The entire page (nav, hero, ticker, copilots, Earnest, CTA, footer)
├── README.md             # This file
├── assets/
│   └── earn_coin.png      # Earn mascot (copied from repo public/earn-coin.png)
├── data/
│   └── activity.json      # Seed data for the Live Activity ticker (fallback source)
└── js/
    ├── activity.js        # Data layer: getChainOfTrustActivity() — live source → JSON fallback
    └── main.js            # Page behaviour: nav blur, ticker render, view-all, Ask Earnest
```

## Editing copy

- **Headlines, sections, CTAs:** all in `index.html`. Sections are labelled with
  numbered comments (`1. NAV`, `2. HERO`, … `8. FOOTER`) so they're easy to find.
- **Copilot capabilities:** in `index.html` under `4. THE COPILOTS`. Each card is
  an `<article>` with an inline SVG icon, an `<h4>` title, and a `<p>`. The cards
  are grouped into clusters (Raise / Source / Analyze & Package / Close); each
  cluster ends with a "Get Started" CTA.
- **Brand palette & fonts:** in the inline `tailwind.config` near the top of
  `index.html` (colours `ink`, `gold`, `gold-deep`, `offwhite`; fonts `serif`
  = Fraunces, `sans` = Inter).

## Editing the activity ticker data

Edit `data/activity.json`. Each entry:

```json
{ "initials": "J.R.", "role": "Family Office", "region": "Chicago",
  "type": "Capital Allocated", "value": "$250K", "date": "Feb 2026" }
```

`type` must be one of:
`Deal Closed`, `Capital Allocated`, `Check Signed`, `Capital Raised`,
`Connector Intro`, `Acquisition Review`.

**Live data later:** `js/activity.js` first tries a live "Chain-of-Trust"
endpoint and falls back to `data/activity.json` on any failure. To go live, set
`CHAIN_OF_TRUST_ENDPOINT` at the top of `activity.js` to your JSON feed (shape:
`{ entries: [ … ] }`). The marquee **pauses on hover** and **respects
`prefers-reduced-motion`** (no auto-scroll when reduced).

## The mascot

The Earn coin lives at `assets/earn_coin.png`. It was copied from the app's
`public/earn-coin.png`. To swap it, replace that file (keep the filename) — it's
referenced as `./assets/earn_coin.png` throughout `index.html` and `js/main.js`.

## Ask Earnest (placeholder)

The floating bottom-right "Ask Earnest" pill opens a placeholder chat panel with
a canned reply. To wire a real backend, see the `TODO(earnest-backend)` comment
in `js/main.js` — replace the canned `setTimeout` reply with a call to your chat
endpoint.

## Deploy to Vercel (as a SEPARATE project)

This page is independent of the Next.js app and should be deployed as its **own**
Vercel project so it never shares a build with the app.

1. In Vercel, **Add New → Project** and import this repo.
2. **Root Directory:** set to `landing`.
3. **Framework Preset:** `Other`.
4. **Build Command:** leave empty (none).
5. **Output Directory:** leave as the root (`.`) — the static files are served
   as-is.
6. Deploy. Point your marketing domain (e.g. `www.fundexecs.com`) at this
   project.

Because the root directory is `landing` and there's no build command, Vercel
serves these files statically. The Next.js app remains a separate Vercel
project with its own settings.

## CI / repo hygiene

The repo runs `eslint .` and `prettier --check .` at the root. This folder is
excluded from both so it never blocks the app's CI:

- `landing/**` is added to the `ignores` array in `../eslint.config.mjs`.
- `landing/` is added to `../.prettierignore`.

So edit freely here without worrying about the app's lint/format rules.
