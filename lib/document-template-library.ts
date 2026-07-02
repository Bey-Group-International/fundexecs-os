// lib/document-template-library.ts
// Pre-built institutional document templates for the data room builder.
// Each template provides a starter markdown scaffold keyed to its data-room section.

export interface DocTemplate {
  id: string;
  label: string;
  description: string;
  section: string;
  content: string;
}

export const DOCUMENT_TEMPLATE_LIBRARY: DocTemplate[] = [
  {
    id: "exec_summary",
    label: "Executive Summary",
    description: "One-page overview of firm, strategy, and track record",
    section: "overview",
    content: `# Executive Summary

_[Firm tagline or positioning statement]_

## Firm Overview

[Two to three sentences describing the firm: what you invest in, where, and why your approach is differentiated.]

## Investment Strategy

**Asset classes:** [e.g. Real estate, private credit, growth equity]
**Geographies:** [e.g. North America, Southeast Asia]
**Stage / type:** [e.g. Value-add, opportunistic, buy-and-build]
**Target check size:** $[X]M – $[Y]M

## Track Record

| Metric | Value |
|--------|-------|
| Gross IRR | [X]% |
| Pooled MOIC | [X]x |
| Total invested | $[X]M |
| Deals (realized) | [N] ([R] realized) |

## Team

- **[Name]** — [Title], [X] years experience, [prior firm or credential]
- **[Name]** — [Title], [X] years experience, [prior firm or credential]

## Fund / Opportunity

[One paragraph on the current fund or deal opportunity, target size, and timeline.]

---
_[Firm name] | [Date] | Confidential_
`,
  },
  {
    id: "pitch_deck_outline",
    label: "Pitch Deck Outline",
    description: "Slide-by-slide outline for LP presentations",
    section: "marketing",
    content: `# Pitch Deck Outline

## Slide 1 — Cover
- Firm name, logo, fund name
- Date and confidentiality notice

## Slide 2 — The Opportunity
- Market dislocation or inefficiency we exploit
- Why now — macro tailwind or structural trend

## Slide 3 — Investment Strategy
- Asset class and geography focus
- Entry thesis and value creation levers
- What we buy / avoid

## Slide 4 — Competitive Advantage
- Proprietary sourcing edge
- Operational capabilities
- Network and relationships

## Slide 5 — Track Record Summary
- Pooled IRR and MOIC since inception
- Number of deals, realized vs. unrealized
- Selected notable exits

## Slide 6 — Representative Investments
- 3–4 case studies: entry thesis → value creation → outcome
- Each: deal name, size, key metrics, status

## Slide 7 — Portfolio (Current)
- Current hold list with marks and status
- Concentration by sector / geography

## Slide 8 — Team
- Partner bios: relevant experience and deal attribution
- Operating partners / advisors

## Slide 9 — Fund Terms
- Target size, first close progress
- Management fee and carried interest
- Term, GP commit, hurdle

## Slide 10 — Fund Structure
- GP / management company structure
- Auditor, fund administrator, legal counsel

## Slide 11 — Why Us — Why Now
- Summary of differentiation
- Current pipeline highlights
- Next steps / contact

---
_[Firm name] | [Fund name] | Confidential — not for distribution_
`,
  },
  {
    id: "lp_update",
    label: "LP Quarterly Update",
    description: "Quarterly letter template for limited partners",
    section: "marketing",
    content: `# [Fund Name] — Q[X] [Year] Investor Update

**To:** Limited Partners
**From:** [GP Name], [Firm Name]
**Date:** [Quarter end date]

---

## Portfolio Overview

As of [date], the portfolio consists of [N] investments across [sectors/geographies]. Total deployed capital is $[X]M against commitments of $[Y]M ([Z]% deployed).

## Performance Summary

| Metric | This Quarter | Inception to Date |
|--------|-------------|-------------------|
| Gross IRR | [X]% | [X]% |
| Net IRR | [X]% | [X]% |
| MOIC | [X]x | [X]x |
| NAV | $[X]M | — |

## Portfolio Activity

### New Investments
- **[Company/Asset]** — $[X]M deployed. [One sentence on thesis.]

### Realizations
- **[Company/Asset]** — exited at [X]x / [X]% IRR. [One sentence on outcome.]

### Portfolio Company / Asset Updates
- **[Holding]** — [Status and key developments]
- **[Holding]** — [Status and key developments]

## Market Observations

[2–3 paragraphs on macro environment, sector-specific trends, and how they affect the portfolio or sourcing pipeline.]

## Pipeline

[Brief description of deal pipeline — volume, quality, and any notable opportunities in advanced diligence.]

## Fund Administration

- **Capital called this quarter:** $[X]M (Cumulative: $[Y]M / [Z]% of commitments)
- **Distributions this quarter:** $[X]M (Cumulative: $[Y]M)
- **Estimated NAV:** $[X]M per $1 invested

## Upcoming

[Key milestones — board meetings, fund close target, expected realizations.]

---

*This letter contains forward-looking statements and is confidential. Past performance is not indicative of future results.*
`,
  },
  {
    id: "tear_sheet",
    label: "Tear Sheet",
    description: "One-page firm snapshot for quick review",
    section: "marketing",
    content: `# [Firm Name] — Tear Sheet

**Strategy:** [One line]
**Founded:** [Year] | **HQ:** [City, Country]
**AUM / Target:** $[X]M | **Stage:** Fund [N] / [Vehicle type]

---

## Strategy at a Glance

| | |
|---|---|
| **Asset class** | [e.g. Lower middle market buyouts] |
| **Geography** | [e.g. North America] |
| **Check size** | $[X]M – $[Y]M |
| **Target IRR** | [X]% gross |
| **Target MOIC** | [X]x gross |

## Track Record

| | |
|---|---|
| **Gross IRR** | [X]% |
| **Pooled MOIC** | [X]x |
| **Total invested** | $[X]M |
| **Deals** | [N] total, [R] realized |
| **Performance period** | [Start] – present |

## Key Team Members

| Name | Role | Background |
|------|------|-----------|
| [Name] | Managing Partner | [Prior firm / credential] |
| [Name] | Partner | [Prior firm / credential] |

## Edge

- [Differentiator 1]
- [Differentiator 2]
- [Differentiator 3]

## Contact

[Name] | [Email] | [Phone]
[Website] | [LinkedIn]

---
_Confidential — [Date]_
`,
  },
  {
    id: "ddq",
    label: "Due Diligence Questionnaire (DDQ)",
    description: "Institutional LP DDQ template for fund managers",
    section: "diligence",
    content: `# Due Diligence Questionnaire

**Firm:** [Firm Name]
**Fund:** [Fund Name]
**Date:** [Date]

---

## Section 1 — Firm Background

**1.1** When was the firm founded and by whom?

> [Answer]

**1.2** Describe the firm's ownership structure. Are there any affiliates or related entities?

> [Answer]

**1.3** Has the firm ever been subject to regulatory action, litigation, or disciplinary proceedings?

> [Answer]

---

## Section 2 — Investment Strategy

**2.1** Describe the fund's investment strategy in detail.

> [Answer]

**2.2** What is the target portfolio size and expected number of investments?

> [Answer]

**2.3** How are investments sourced? Describe the sourcing process and competitive advantages.

> [Answer]

**2.4** Describe the investment selection and approval process.

> [Answer]

**2.5** What is the exit strategy for investments?

> [Answer]

---

## Section 3 — Track Record

**3.1** Provide a summary of the firm's track record since inception.

> [Answer — attach track record schedule]

**3.2** Have there been any investments where the firm lost more than 50% of invested capital?

> [Answer]

**3.3** Describe any material changes in strategy or personnel over the track record period.

> [Answer]

---

## Section 4 — Team

**4.1** Provide biographies of all investment professionals.

> [Answer — attach biographies]

**4.2** What is the carry allocation among team members?

> [Answer]

**4.3** Have any investment professionals departed in the past three years? If so, explain.

> [Answer]

---

## Section 5 — Fund Terms

**5.1** What is the target fund size and hard cap?

> [Answer]

**5.2** Describe the management fee structure.

> [Answer]

**5.3** Describe the carried interest structure including hurdle rate and catch-up.

> [Answer]

**5.4** What is the GP commitment?

> [Answer]

**5.5** What are the key investor protections (LPAC, key man, no-fault divorce)?

> [Answer]

---

## Section 6 — Risk Management & Compliance

**6.1** Describe the firm's compliance program and key policies.

> [Answer]

**6.2** Is the firm registered with any regulatory authority (e.g. SEC, FCA, FINRA)?

> [Answer]

**6.3** How does the firm manage conflicts of interest?

> [Answer]

---

## Section 7 — Operations

**7.1** Who are the fund's service providers (auditor, administrator, legal counsel, prime broker)?

> [Answer]

**7.2** How is fund accounting and reporting handled?

> [Answer]

**7.3** Describe the firm's cybersecurity and data protection policies.

> [Answer]

---

*Please direct any questions to [Contact Name] at [Email] | [Phone].*
`,
  },
  {
    id: "fund_terms",
    label: "Fund Terms Summary",
    description: "Plain-English summary of key fund terms for LPs",
    section: "fund_terms",
    content: `# Fund Terms Summary

**Fund:** [Fund Name]
**Manager:** [Firm Name]
**As of:** [Date]

---

## Fund Overview

| | |
|---|---|
| **Fund type** | [Limited Partnership / LLC / other] |
| **Jurisdiction** | [Delaware / Cayman / other] |
| **Target size** | $[X]M |
| **Hard cap** | $[X]M |
| **Minimum commitment** | $[X]M |
| **First close target** | [Date] |
| **Final close target** | [Date] |

## Economics

| | |
|---|---|
| **Management fee** | [X]% p.a. on [committed / invested] capital |
| **Management fee step-down** | [e.g. reduces to Y% post-investment period] |
| **Carried interest** | [X]% |
| **Hurdle rate** | [X]% preferred return (non-compounding / compounding) |
| **Catch-up** | [X]% GP catch-up until [X]% / [X]% split |
| **GP commitment** | $[X]M ([X]% of fund) |

## Fund Life

| | |
|---|---|
| **Investment period** | [X] years from final close |
| **Fund term** | [X] years from final close |
| **Extension options** | [X] × [X]-year extension with [LPAC / majority LP] approval |

## Governance & Protections

- **LPAC:** Yes — comprised of [N] LP representatives
- **Key man:** [Names of key persons]; [X]-month cure period
- **No-fault divorce:** [Majority / supermajority] LP vote required
- **Advisory fee offset:** [X]% of advisory / monitoring fees offset against management fee
- **Most-favored nation (MFN):** Standard MFN provisions apply

## Distributions

[Describe distribution waterfall — European vs American waterfall, clawback provisions, tax withholding approach.]

---

*This summary is for informational purposes and is qualified in its entirety by the Limited Partnership Agreement. Please consult the LPA and subscription documents for complete terms.*
`,
  },
  {
    id: "track_record_schedule",
    label: "Track Record Schedule",
    description: "Detailed investment-by-investment performance table",
    section: "track_record",
    content: `# Track Record Schedule

**Firm:** [Firm Name]
**As of:** [Date]
**Audited / Unaudited:** [State]

---

## Performance Summary

| | All Deals | Realized | Unrealized |
|---|---|---|---|
| **Gross IRR** | [X]% | [X]% | — |
| **Gross MOIC** | [X]x | [X]x | [X]x |
| **Total invested** | $[X]M | $[X]M | $[X]M |
| **Total value** | $[X]M | $[X]M | $[X]M |
| **# Deals** | [N] | [R] | [U] |

---

## Investment Details

| Deal | Vintage | Invested ($M) | Realized ($M) | Unrealized ($M) | Total Value ($M) | Gross MOIC | Gross IRR | Status |
|------|---------|--------------|---------------|-----------------|-----------------|------------|-----------|--------|
| [Name] | [Year] | [X] | [X] | [X] | [X] | [X]x | [X]% | Realized |
| [Name] | [Year] | [X] | [X] | [X] | [X] | [X]x | — | Unrealized |
| [Name] | [Year] | [X] | [X] | [X] | [X] | [X]x | [X]% | Realized |

---

## Methodology Notes

- Returns shown are gross of management fees and carried interest.
- Unrealized values represent [fair value / cost / third-party appraisal] as of [date].
- IRR is calculated from the date of initial investment to the date of realization or [date].
- [Any other methodology disclosures.]

---

*Past performance is not indicative of future results. This schedule is confidential and for qualified investors only.*
`,
  },
  {
    id: "team_bios",
    label: "Team Biographies",
    description: "Professional biographies for all key investment personnel",
    section: "team",
    content: `# Team Biographies

---

## [Full Name]
**[Title] — [Firm Name]**

[Two to three paragraphs covering: current role and responsibilities; prior investment and operating experience; notable transactions or achievements; educational background and credentials.]

**Prior experience:** [Firm 1], [Firm 2]
**Education:** [Degree, Institution, Year]

---

## [Full Name]
**[Title] — [Firm Name]**

[Two to three paragraphs covering: current role and responsibilities; prior investment and operating experience; notable transactions or achievements; educational background and credentials.]

**Prior experience:** [Firm 1], [Firm 2]
**Education:** [Degree, Institution, Year]

---

## [Full Name]
**[Title] — [Firm Name]**

[Two to three paragraphs covering: current role and responsibilities; prior investment and operating experience; notable transactions or achievements; educational background and credentials.]

**Prior experience:** [Firm 1], [Firm 2]
**Education:** [Degree, Institution, Year]

---

## Board Observers & Advisors

### [Advisor Name]
[One paragraph on the advisor's background and the nature of their relationship with the firm.]

---

*Biographies current as of [Date].*
`,
  },
  {
    id: "compliance_overview",
    label: "Compliance Overview",
    description: "Regulatory registrations, policies, and compliance framework",
    section: "compliance",
    content: `# Compliance & Regulatory Overview

**Firm:** [Firm Name]
**Date:** [Date]

---

## Regulatory Status

| | |
|---|---|
| **Registration** | [e.g. SEC Registered Investment Adviser — Form ADV] |
| **Registration date** | [Date] |
| **CRD / IARD number** | [Number] |
| **Regulatory AUM** | $[X]M |

[List any other regulatory registrations: FINRA, FCA, CFTC, etc.]

---

## Compliance Program

The firm maintains a written compliance manual and has designated a Chief Compliance Officer (CCO).

**CCO:** [Name], [Title]
**Last compliance review:** [Date]
**Compliance consultant:** [Name, if applicable]

### Core Policies

- **Code of Ethics** — Personal account trading pre-clearance; gifts and entertainment limits; outside business activity restrictions
- **AML / KYC** — Customer identification program; beneficial ownership verification; OFAC screening
- **Privacy Policy** — Client information handling; Regulation S-P compliance
- **Cybersecurity** — Written information security program; incident response plan
- **Business Continuity** — Business continuity and disaster recovery plan; annual testing
- **Trade Execution** — Best execution policy; soft dollars; trade allocation

---

## Regulatory History

The firm and its principals have not been subject to any regulatory action, disciplinary proceeding, criminal charge, or civil litigation involving fraud, securities law violations, or breach of fiduciary duty.

[OR describe any material regulatory events and resolution.]

---

## Insurance

| Coverage | Carrier | Limit |
|----------|---------|-------|
| E&O / Professional liability | [Carrier] | $[X]M |
| D&O | [Carrier] | $[X]M |
| Cyber liability | [Carrier] | $[X]M |

---

*This overview is a summary. Please request the full compliance manual and Form ADV Parts 1, 2A, and 2B for complete disclosure.*
`,
  },
  {
    id: "investor_relations_faq",
    label: "Investor Relations FAQ",
    description: "Common LP questions and answers for fund marketing",
    section: "marketing",
    content: `# Frequently Asked Questions

**[Firm Name] | [Fund Name]**

---

**Q: What is your investment strategy?**

A: [Describe strategy in 2–3 sentences: asset class, geography, stage, and core thesis.]

---

**Q: What is your track record?**

A: Since inception in [year], we have deployed $[X]M across [N] investments. Our realized track record shows a [X]% gross IRR and [X]x gross MOIC. [Optional: note any unrealized portfolio context.]

---

**Q: Who are the key members of the team?**

A: [Brief team overview. Reference full biographies in the data room.]

---

**Q: What is the fund size and minimum commitment?**

A: [Fund name] is targeting $[X]M with a hard cap of $[Y]M. The minimum LP commitment is $[Z]M; we consider smaller commitments on a case-by-case basis.

---

**Q: What are the fund economics?**

A: [X]% management fee on [committed/invested] capital, [X]% carried interest over a [X]% hurdle, with [European/American] waterfall.

---

**Q: What is your deal sourcing process?**

A: [Describe proprietary sourcing channels, relationships, off-market access, etc.]

---

**Q: How do you add value beyond capital?**

A: [Describe operational support, network, board involvement, etc.]

---

**Q: How often do you report to LPs?**

A: LPs receive quarterly written updates within [X] days of quarter end, audited financials within [X] days of year end, and K-1s by [date]. We also hold an annual LP meeting.

---

**Q: Who are your service providers?**

A: **Auditor:** [Firm] | **Fund administrator:** [Firm] | **Legal counsel:** [Firm] | **Prime broker / custodian:** [Firm]

---

**Q: How can I get additional information?**

A: Please contact [Name] at [email] or [phone]. We are happy to schedule a call with the investment team.

---

*[Date] | Confidential*
`,
  },
  {
    id: "investment_thesis",
    label: "Investment Thesis",
    description: "Detailed strategy document covering mandate, edge, and market context",
    section: "thesis",
    content: `# Investment Thesis

**[Firm Name]**

---

## Market Opportunity

[2–3 paragraphs describing the market inefficiency, dislocation, or structural trend that creates the investment opportunity. Include relevant market size, dynamics, and timing factors.]

## Mandate

**Asset class:** [e.g. Real estate / Private credit / Growth equity]
**Geography:** [e.g. North America, with focus on Sun Belt markets]
**Stage / type:** [e.g. Value-add, opportunistic, middle market buyouts]
**Check size:** $[X]M – $[Y]M equity per deal
**Target returns:** [X]% gross IRR / [X]x gross MOIC

## Investment Criteria

We target [description of target assets/companies] that exhibit:

- [Criterion 1 — e.g. Stable cash flows with improvement potential]
- [Criterion 2 — e.g. Defensible market position in fragmented sector]
- [Criterion 3 — e.g. Identifiable operational or capital structure inefficiency]
- [Criterion 4 — e.g. Clear path to multiple exit options]

## Value Creation Framework

### [Lever 1 — e.g. Operational Improvement]
[Describe specific operational improvements and how the team executes them.]

### [Lever 2 — e.g. Financial Engineering]
[Describe capital structure optimization, refinancing, or other financial levers.]

### [Lever 3 — e.g. Strategic Repositioning]
[Describe strategic initiatives — new markets, adjacencies, M&A.]

## Competitive Differentiation

[Why does this team win in its target market? Proprietary sourcing relationships, unique expertise, operational platform, speed/certainty of close, etc.]

## Exit Strategy

[Describe primary and secondary exit paths — strategic buyers, financial sponsors, public markets, recapitalization — and supporting evidence from prior exits.]

## Risk Considerations

[Enumerate key risks and mitigants: market risk, execution risk, liquidity risk, regulatory risk, key man risk.]

---

*Confidential — For Qualified Investors Only | [Date]*
`,
  },
];

export function getTemplatesBySection(section: string): DocTemplate[] {
  return DOCUMENT_TEMPLATE_LIBRARY.filter((t) => t.section === section);
}

export function getTemplate(id: string): DocTemplate | undefined {
  return DOCUMENT_TEMPLATE_LIBRARY.find((t) => t.id === id);
}
