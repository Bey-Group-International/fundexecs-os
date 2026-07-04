# FundExecs Technologies — 5-Year Financial Model

*Confidential · July 2026*

> **Important:** This is an illustrative planning model, not a forecast. All figures are management estimates derived from the stated assumptions and should be stress-tested in diligence. FY1 begins at close of the seed round (assumed Q4 2026). Figures in USD.

---

## 1. Model structure

Revenue builds bottom-up from **paying organizations × blended ARPA**, where ARPA (average revenue per account, annualized) combines subscription tier + metered credit usage. Current in-product pricing ($5/$30/$100 per month) is deliberate early-access pricing; the model assumes staged institutional repricing as deliverable value is proven with design partners.

### Pricing assumptions (blended ARPA by year)

| | FY1 | FY2 | FY3 | FY4 | FY5 |
|---|---|---|---|---|---|
| Starter-tier equivalent ($/org/mo) | 50 | 100 | 125 | 150 | 175 |
| Pro-tier equivalent ($/org/mo) | 300 | 450 | 600 | 700 | 800 |
| Scale-tier equivalent ($/org/mo) | 1,000 | 1,250 | 1,500 | 1,750 | 2,000 |
| Mix (Starter/Pro/Scale) | 55/35/10 | 50/38/12 | 45/40/15 | 40/42/18 | 35/43/22 |
| Credits/usage uplift on subscription | +15% | +20% | +25% | +30% | +30% |
| **Blended ARPA ($/org/yr)** | **~3,200** | **~5,300** | **~7,800** | **~10,400** | **~13,200** |

Blended ARPA is computed, not assumed: (mix-weighted monthly price) × 12 × (1 + usage uplift). The companion workbook (`08-five-year-financial-model.xlsx`) carries these as live formulas. Rationale: Pro-tier at $450–$800/mo remains <2% of the cost of one analyst hire; Scale-tier at $1.25–2K/mo remains a fraction of a single DealCloud or Juniper Square contract while covering far more surface.

### Customer assumptions

| | FY1 | FY2 | FY3 | FY4 | FY5 |
|---|---|---|---|---|---|
| New paying orgs added | 45 | 135 | 330 | 640 | 1,080 |
| Gross logo churn (annual) | 15% | 15% | 12% | 10% | 10% |
| **Paying orgs (EOY)** | **40** | **160** | **450** | **1,000** | **1,900** |
| Net revenue retention | 100% | 110% | 115% | 118% | 120% |

Acquisition mix: FY1 is founder-led + design partners; FY2–FY3 add salon/referral/PLG; FY4–FY5 add partner channel. FY5's 1,900 orgs ≈ 4–5% of the ~40–45K addressable firms (document 10) — ambitious but not implausible for a category leader.

## 2. Revenue build

| $M | FY1 | FY2 | FY3 | FY4 | FY5 |
|---|---|---|---|---|---|
| Subscription + usage ARR (EOY) = orgs × ARPA | 0.13 | 0.85 | 3.5 | 10.4 | 25.1 |
| Marketplace + data/API ARR | — | 0.05 | 0.55 | 1.5 | 3.0 |
| **Total ARR (EOY)** | **0.13** | **0.90** | **4.1** | **11.9** | **28.1** |
| **Recognized revenue** (≈ avg of opening/closing ARR × 95%) | **0.06** | **0.5** | **2.4** | **7.6** | **19.0** |

Marketplace/data revenue = take-rate on matched transactions + API grants, ramping only after the marketplace ships (FY2+); held deliberately conservative.

## 3. P&L summary

| $M | FY1 | FY2 | FY3 | FY4 | FY5 |
|---|---|---|---|---|---|
| Revenue | 0.06 | 0.5 | 2.4 | 7.6 | 19.0 |
| COGS (AI compute, infra, support) | 0.03 | 0.15 | 0.55 | 1.6 | 3.6 |
| **Gross profit** | 0.03 | 0.35 | 1.85 | 6.0 | 15.4 |
| **Gross margin** | ~45% | ~69% | ~77% | ~79% | ~81% |
| R&D / Engineering | 0.9 | 1.5 | 2.6 | 4.5 | 7.0 |
| Sales & Marketing | 0.2 | 0.5 | 1.3 | 2.7 | 4.9 |
| G&A (incl. legal/compliance) | 0.3 | 0.5 | 0.9 | 1.6 | 2.5 |
| **Total OpEx** | **1.4** | **2.5** | **4.8** | **8.8** | **14.4** |
| **EBITDA** | **(1.37)** | **(2.15)** | **(2.95)** | **(2.8)** | **+1.0** |

Gross margin starts low (heavy AI usage per early account, unpriced pilots) and normalizes to ~80% as model costs fall, routing improves, and repricing lands. EBITDA breakeven during FY5 on this plan; a Series A (~FY2/FY3, at or above $1M ARR) funds the FY3–FY4 loss years.

## 4. Headcount plan

| FTEs (EOY) | FY1 | FY2 | FY3 | FY4 | FY5 |
|---|---|---|---|---|---|
| Engineering & product | 4 | 7 | 12 | 20 | 30 |
| GTM & success | 1 | 3 | 7 | 13 | 21 |
| G&A / ops | 1 | 2 | 3 | 5 | 8 |
| **Total** | **6** | **12** | **22** | **38** | **59** |

The product's own thesis applies internally: agents carry a large share of support, content, and ops work, keeping revenue per employee high (target >$300K by FY5).

## 5. Cash view

- **Seed ($2.5M, Q4 2026)** funds FY1–FY2 to ~$1M ARR run-rate (details: document 09).
- **Series A (assumed ~$8–12M, FY3)** funds the scale-out through FY4.
- Cumulative pre-profitability burn ≈ $9M; company reaches EBITDA-positive run-rate in FY5.

## 6. Key sensitivities

| Variable | Downside effect | Mitigant |
|---|---|---|
| Repricing lags proof of value | FY3+ ARR −40–50% | Credits still capture usage growth; delay hires to match |
| Churn 20%+ in beachhead | FY5 orgs ~1,300 | Compounding graphs/Brains raise switching costs with tenure |
| AI compute cost doesn't fall | GM plateaus ~70% | Cost-tiered routing (already live), per-run caps, pass-through via credits |
| Slower logo adds (½ pace) | FY5 ARR ~$14M | Still a strong Series B profile; burn scales down with GTM spend |

## 7. What would make the model conservative

- No pricing captured here for the trust layer (attestations, verified track record, reputation entitlements) — a plausible premium SKU.
- Marketplace take-rate held to a token ramp.
- No LP/allocator-side monetization despite the portal existing in-product.
- ARPA ceilings well below incumbent enterprise contracts (DealCloud-class deployments commonly run $50K–$250K+/yr).
