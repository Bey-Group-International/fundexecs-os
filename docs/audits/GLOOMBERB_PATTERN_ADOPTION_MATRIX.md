# Gloomberb Pattern Adoption Matrix (Phase 0)

**Reference:** `github.com/vincelwt/gloomberb` — a keyboard-driven, multi-pane,
command-bar markets terminal. Used here **strictly as architectural inspiration**.

**Guardrails honored (from the spec):**
- Extract *patterns*, not code, branding, names, visual identity, or
  public-equity/retail-trading terminology.
- **No hard dependency** on the Gloomberb runtime. FundExecs remains the product,
  system of record, and UX.
- Any *code* actually adapted must first pass a license + security + maintenance
  review (see "Adaptation protocol" below). This matrix adapts **patterns**; no
  Gloomberb source is vendored.
- Not a Bloomberg visual clone; not a retail trading terminal.

Each row: the pattern → its private-markets reinterpretation → the native
FundExecs implementation seam → build disposition (`REUSE`/`ACTIVATE`/`BUILD`).

---

| # | Gloomberb pattern | Private-markets reinterpretation | Native FundExecs seam | Disposition |
|---|---|---|---|---|
| 1 | **Multi-pane, resizable/dockable workspace** | Assemble an operating surface per mandate (underwriting, IR, portfolio) instead of one dashboard | New `terminal_*` tables + a pane framework wrapping existing surfaces (`DealWarRoom`, `CapitalMap`, portfolio, `Copilot`, signals) | **BUILD** shell, **REUSE** panes |
| 2 | **Command bar as the primary interaction (Cmd-K, typeahead, aliases)** | `DEAL Maple St`, `LBO`, `CAPCALL Fund II`, `ASK EARN …` | Extend the existing `CommandPalette`/`GlobalCommandPalette` primitive; new `CommandDefinition` registry | **REUSE** primitive, **BUILD** registry |
| 3 | **Terse command language over a symbol/entity** | Entity-keyed commands over deals/funds/investors/companies, not tickers | `lib/nav-commands.ts` catalog → entity resolvers + war-room loads | **ACTIVATE** |
| 4 | **Entity-keyed views ("open X, see everything about X")** | Deal/Investor/Asset War Rooms; add Fund/Company | `lib/{run,source,execute}-war-room.ts` + new Fund/Company loaders | **REUSE** + **BUILD** |
| 5 | **Watchlists as first-class navigation + monitoring** | Watch companies/funds/investors/sectors/deadlines/mandates | `watchlists`/`watchlist_items` schema (inert today) + intelligence ingest scoping | **ACTIVATE** |
| 6 | **Real-time streaming panes / live tiles** | Live task/agent events, capital signals, mark updates | Supabase Realtime already used (`task_events`, `GridLive`, observations/assessments) | **REUSE** |
| 7 | **Provider-neutral data layer behind a normalization boundary** | One internal schema; providers are swappable feeds | `lib/intelligence/provider.ts` + `ProviderObservation` anti-corruption boundary (~80% of System 12) | **REUSE**/**ACTIVATE** |
| 8 | **News/event feed with entity linking** | PE/M&A/credit/fundraising/filings/macro linked to mandate + entity | Intelligence core `observations`→`assessments`→routing; **extension** providers (SEC/macro/news) | **ACTIVATE** core, **EXTENSION** feeds |
| 9 | **Keyboard-first navigation / hotkeys** | ⌘K, pane hotkeys, quick-jump | `CommandPalette` focus-trap + `[data-owns-cmdk]` arbitration; wire the declared-but-dead `lib/shortcuts.ts` | **REUSE** + **ACTIVATE** |
| 10 | **Saved/named layouts + presets** | 10 default mandate workspaces (underwriting, IR, credit, exec brief…) | New `terminal_workspaces`/`terminal_layouts`; presets compose existing panes | **BUILD** |
| 11 | **Charting / time-series tiles** | NAV series, valuation history, exposure, KPI trends | `lib/valuation-series.ts`, `portfolio-monitor.ts`, `grid-trends.ts` (+ `dataviz` conventions) | **REUSE** |
| 12 | **Deep-linkable terminal state** | Shareable workspace + entity + command state | Next.js App Router routes; new deep-link serializer over `terminal_*` | **BUILD** |
| 13 | **Plugin/extension surface for new panes + data** | FundExecs Extensions (panes, commands, providers, tools) | Manifest → existing registries (skills/intelligence/inference/integrations) | **BUILD** platform, **REUSE** registries |
| 14 | **Fast fuzzy entity search from the command bar** | Search deals/funds/investors/companies/people from `Cmd-K` | Broaden `lib/search.ts` (today deals/investors/assets, `ILIKE`) + wire semantic indexes (`brain_kb_hybrid_search`) | **ACTIVATE** |
| 15 | **Client-side performance discipline (virtualization, lazy panes)** | Dense financial tables must stay responsive | Per-pane Suspense + lazy load; error boundary per pane | **BUILD** (in shell) |

---

## Patterns explicitly NOT adopted

| Anti-pattern | Reason |
|---|---|
| Bloomberg orange/black identity; ticker-tape chrome | Spec forbids visual cloning; keep FundExecs institutional theme |
| Public-equity terminology (tickers, order books, Level II) | Private markets are entity/relationship/commitment-keyed, not quote-keyed |
| Retail trade-execution surfaces | Capital actions are Tier-3, human-gated; no one-click execution |
| A separate microsite / disconnected terminal runtime | Terminal must live inside the app shell, share auth/RLS/records |
| Hard dependency on Gloomberb / its data vendors | Everything strategic is native; Gloomberb interop is an off-by-default, read-only **extension** only |

---

## Adaptation protocol (if any Gloomberb code is ever adapted)

Patterns above require **no** Gloomberb code. Should a specific utility ever be
considered for adaptation, it must pass, and be recorded in
`docs/audits/`, a review of:

1. **License** — compatibility with FundExecs distribution; attribution recorded.
2. **Security** — no unreviewed network calls, eval, or secret handling; runs only
   in the sandbox tier (never the primary runtime).
3. **Maintenance** — upstream health; whether a native reimplementation is cheaper
   than carrying the dependency.
4. **Architectural fit** — must conform to the house registry pattern + gates +
   RLS; may never weaken the action/safety contract.

Default posture: **reimplement the pattern natively** (as this matrix does) rather
than vendor code.
