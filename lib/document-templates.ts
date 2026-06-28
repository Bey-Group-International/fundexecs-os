// lib/document-templates.ts
// Built-in document templates with variable interpolation.
// All template bodies return Markdown suitable for preview and DocuSign.

import type { DocumentType } from "./contracts";

export interface TemplateVars {
  fundName: string;
  orgName: string;
  jurisdiction: string;
  effectiveDate: string;
  investorName?: string;
  commitmentAmount?: string;
  managementFee?: string;
  carry?: string;
  preferredReturn?: string;
  dealName?: string;
}

function v(val: string | undefined, fallback = "___"): string {
  return val && val.trim() ? val : fallback;
}

const TEMPLATES: Record<DocumentType, (vars: TemplateVars) => string> = {
  subscription_agreement: (vars) => `# Subscription Agreement

**${v(vars.fundName)}**
Effective Date: ${v(vars.effectiveDate)}

---

## 1. Investor Details

**Investor:** ${v(vars.investorName)}
**Manager / GP:** ${v(vars.orgName)}
**Jurisdiction:** ${v(vars.jurisdiction)}

---

## 2. Commitment

The Investor hereby subscribes for a limited partnership interest in **${v(vars.fundName)}** (the "Fund") in the aggregate amount of **${v(vars.commitmentAmount, "$ ___")}** (the "Commitment").

Capital contributions will be drawn down pursuant to capital call notices delivered by the General Partner with no fewer than ten (10) business days' prior written notice.

---

## 3. Representations and Warranties

The Investor represents and warrants that:

(a) it is an **Accredited Investor** as defined under Regulation D of the Securities Act of 1933, as amended;

(b) it is acquiring the interest for its own account for investment purposes only, not with a view to distribution or resale;

(c) it has sufficient knowledge and experience in financial and business matters to evaluate the merits and risks of this investment;

(d) it can bear the economic risk of the investment, including a total loss of its Commitment.

---

## 4. Fees

- **Management Fee:** ${v(vars.managementFee, "__ %")} per annum on committed capital during the investment period, then on invested capital thereafter.
- **Carried Interest:** ${v(vars.carry, "__ %")} of net profits above a preferred return of ${v(vars.preferredReturn, "__ %")} per annum.

---

## 5. Signature

By executing below, the Investor agrees to the terms and conditions of the Limited Partnership Agreement of ${v(vars.fundName)} and this Subscription Agreement.

**Investor:**

Signature: ____________________________
Name: ${v(vars.investorName)}
Title: ____________________________
Date: ____________________________

**General Partner (${v(vars.orgName)}):**

Signature: ____________________________
Name: ____________________________
Title: ____________________________
Date: ____________________________
`,

  side_letter: (vars) => `# Side Letter

**${v(vars.fundName)} — ${v(vars.investorName)}**
Effective Date: ${v(vars.effectiveDate)}

---

This letter agreement (this "Side Letter") is entered into as of the Effective Date between **${v(vars.orgName)}** ("General Partner") and **${v(vars.investorName)}** ("LP") in connection with the LP's investment in **${v(vars.fundName)}** (the "Fund").

---

## 1. Most Favored Nation

The GP agrees to provide the LP with written notice of any economic terms, rights, or privileges granted to any other investor in the Fund that are more favorable than those granted to the LP in its Subscription Agreement. The LP shall have the right to elect to receive such more favorable terms within fifteen (15) business days of such notice.

---

## 2. Reporting

In addition to the standard quarterly reports provided to all Limited Partners, the GP shall provide the LP with:

- Monthly net asset value estimates;
- Prompt notice of any material adverse developments affecting the Fund or any portfolio investment.

---

## 3. Preferred Return

The LP's preferred return shall be **${v(vars.preferredReturn, "__ %")}** per annum, compounded annually, prior to any participation by the GP in distributions.

---

## 4. No-Shop

The Fund shall not offer participations to any competitor of the LP (as reasonably defined by the LP in writing) without the LP's prior written consent during the investment period.

---

## 5. Counterparts; Entire Agreement

This Side Letter may be executed in counterparts. Together with the Partnership Agreement and Subscription Agreement, this Side Letter constitutes the entire agreement between the parties with respect to the subject matter hereof.

**General Partner (${v(vars.orgName)}):**

Signature: ____________________________
Name: ____________________________
Title: ____________________________

**LP (${v(vars.investorName)}):**

Signature: ____________________________
Name: ____________________________
Title: ____________________________
`,

  lpa: (vars) => `# Limited Partnership Agreement

**${v(vars.fundName)}**
A ${v(vars.jurisdiction)} Limited Partnership

Effective Date: ${v(vars.effectiveDate)}

---

## Article I — Formation

${v(vars.fundName)} (the "Partnership") is formed as a limited partnership under the laws of ${v(vars.jurisdiction)} pursuant to the terms of this Agreement.

**General Partner:** ${v(vars.orgName)}

---

## Article II — Purpose

The purpose of the Partnership is to make investments in accordance with the Investment Policy as established by the General Partner, and to carry on any activities reasonably incidental or related thereto.

---

## Article III — Capital Contributions

3.1 Each Limited Partner shall make Capital Contributions to the Partnership in the amount of their respective Commitment as set forth in their Subscription Agreement.

3.2 The General Partner may issue capital call notices to Limited Partners with not fewer than ten (10) business days' prior written notice.

---

## Article IV — Distributions

4.1 Distributions shall be made in the following order of priority:

(a) First, to all Partners pro-rata until each has received a cumulative preferred return of **${v(vars.preferredReturn, "__ %")}** per annum;

(b) Then, to the General Partner until it has received **${v(vars.carry, "__ %")}** of the cumulative profits distributed;

(c) Thereafter, **${v(vars.carry, "__ %")}** to the General Partner and the remainder to all Partners pro-rata.

---

## Article V — Management

The General Partner shall have full and exclusive authority to manage and control the business and affairs of the Partnership. The Limited Partners shall take no part in the management of the Partnership's business.

---

## Article VI — Fees

**Management Fee:** ${v(vars.managementFee, "__ %")} per annum during the investment period, thereafter on invested capital.

---

## Article VII — Term

The Partnership shall continue until the earlier of (i) ten (10) years from the Final Closing Date, or (ii) dissolution and winding up as provided herein, unless extended by the General Partner for up to two (2) one-year periods.

---

*[Full LPA to be provided by fund counsel — this is a structural outline for review purposes.]*
`,

  nda: (vars) => `# Non-Disclosure Agreement

Effective Date: ${v(vars.effectiveDate)}

**Disclosing Party:** ${v(vars.orgName)}
**Receiving Party:** ${v(vars.investorName)}

---

## 1. Confidential Information

"Confidential Information" means any and all non-public information disclosed by the Disclosing Party to the Receiving Party in connection with the evaluation of an investment in ${v(vars.fundName)}, including but not limited to financial data, investment strategies, portfolio company information, and LP lists.

---

## 2. Obligations

The Receiving Party shall:

(a) hold all Confidential Information in strict confidence;

(b) not disclose any Confidential Information to any third party without prior written consent;

(c) use the Confidential Information solely for the purpose of evaluating the investment opportunity.

---

## 3. Term

This Agreement shall remain in effect for a period of two (2) years from the Effective Date.

---

## 4. Governing Law

This Agreement shall be governed by the laws of ${v(vars.jurisdiction)}.

---

**${v(vars.orgName)}:**

Signature: ____________________________
Date: ____________________________

**${v(vars.investorName)}:**

Signature: ____________________________
Date: ____________________________
`,

  loi: (vars) => `# Letter of Intent

Date: ${v(vars.effectiveDate)}

**${v(vars.orgName)}**
Re: Proposed Investment in ${v(vars.dealName, v(vars.fundName))}

---

This Letter of Intent ("LOI") sets forth the principal terms under which ${v(vars.orgName)} (the "Investor") proposes to invest in **${v(vars.dealName, "___")}** (the "Company").

---

## Proposed Terms

| Term | Detail |
|------|--------|
| Investment Amount | ${v(vars.commitmentAmount, "$___")} |
| Instrument | Preferred Equity |
| Valuation | To be determined in diligence |
| Closing | Target within 60 days of LOI execution |
| Jurisdiction | ${v(vars.jurisdiction)} |

---

## Exclusivity

The parties agree to an exclusivity period of forty-five (45) days from the date hereof during which the Company shall not solicit or negotiate alternative transactions.

---

## Non-Binding

This LOI is non-binding except for the provisions regarding Exclusivity and Confidentiality.

**${v(vars.orgName)}:**

Signature: ____________________________
Date: ____________________________
`,

  term_sheet: (vars) => `# Term Sheet

**${v(vars.dealName, v(vars.fundName))}**
Date: ${v(vars.effectiveDate)}

---

## Summary of Proposed Terms

| | |
|---|---|
| **Issuer** | ${v(vars.dealName, "___")} |
| **Investor / Lead** | ${v(vars.orgName)} |
| **Investment Amount** | ${v(vars.commitmentAmount, "$___")} |
| **Security** | Series A Preferred Units |
| **Pre-Money Valuation** | To be determined |
| **Preferred Return** | ${v(vars.preferredReturn, "__ %")} cumulative |
| **Closing** | Within 45 days of signing |
| **Jurisdiction** | ${v(vars.jurisdiction)} |

---

## Key Terms

**Board Representation:** One board seat to the lead investor.

**Pro-Rata Rights:** Lead investor has pro-rata participation rights in subsequent financing rounds.

**Information Rights:** Monthly management accounts; annual audited financials within 90 days of year-end.

**Drag-Along:** Standard drag-along provisions upon supermajority approval.

---

*This term sheet is non-binding and subject to execution of definitive agreements.*
`,

  co_invest_agreement: (vars) => `# Co-Investment Agreement

**${v(vars.fundName)} — Co-Investment Vehicle**
Effective Date: ${v(vars.effectiveDate)}

---

This Co-Investment Agreement is entered into between **${v(vars.orgName)}** ("Lead Investor") and **${v(vars.investorName)}** ("Co-Investor") with respect to the co-investment opportunity in **${v(vars.dealName, "___")}** (the "Portfolio Company").

---

## 1. Co-Investment Amount

Co-Investor agrees to commit **${v(vars.commitmentAmount, "$___")}** on the same economic terms as the Lead Investor's direct investment in the Portfolio Company.

---

## 2. Economics

Co-Investor will receive its pro-rata share of returns based on its proportional ownership. No management fee or carried interest shall be charged on the co-investment amount.

---

## 3. Decision Rights

The Lead Investor shall have exclusive authority over investment decisions, follow-on investments, and exit timing. Co-Investor shall have information rights only.

---

## 4. Term

This Agreement shall terminate upon the earlier of (i) disposition of all interests in the Portfolio Company or (ii) ten (10) years from the Effective Date.

**Lead Investor (${v(vars.orgName)}):**

Signature: ____________________________
Date: ____________________________

**Co-Investor (${v(vars.investorName)}):**

Signature: ____________________________
Date: ____________________________
`,

  advisory_agreement: (vars) => `# Advisory Agreement

Effective Date: ${v(vars.effectiveDate)}

**Principal:** ${v(vars.orgName)}
**Advisor:** ${v(vars.investorName)}

---

## 1. Services

The Advisor agrees to provide strategic advisory services to ${v(vars.orgName)} in connection with its investment activities, including introductions, market intelligence, and strategic guidance.

---

## 2. Compensation

In consideration for the Services, the Principal shall grant the Advisor carried interest participation of **${v(vars.carry, "__ %")}** of the Principal's carried interest in investments sourced through the Advisor's direct introductions.

---

## 3. Term

This Agreement shall remain in effect for one (1) year and shall automatically renew for successive one-year terms unless terminated upon thirty (30) days' written notice by either party.

---

## 4. Confidentiality

Advisor agrees to maintain strict confidentiality with respect to all non-public information regarding the Principal, its investors, and its portfolio.

**${v(vars.orgName)}:**

Signature: ____________________________
Date: ____________________________

**Advisor (${v(vars.investorName)}):**

Signature: ____________________________
Date: ____________________________
`,

  other: (vars) => `# Document

**${v(vars.orgName)}**
Date: ${v(vars.effectiveDate)}

---

*[Insert document content here. This is a blank template for custom documents.]*

---

**${v(vars.orgName)}:**

Signature: ____________________________
Date: ____________________________
`,
};

export function renderDocumentTemplate(docType: DocumentType, vars: TemplateVars): string {
  const fn = TEMPLATES[docType];
  if (!fn) return `# ${docType}\n\n*No template available.*`;
  return fn(vars);
}

export const LP_DOCUMENT_TYPES: DocumentType[] = [
  "subscription_agreement",
  "side_letter",
  "nda",
  "co_invest_agreement",
];

export const FUND_DOCUMENT_TYPES: DocumentType[] = ["lpa", "term_sheet", "loi"];

export const ALL_DOCUMENT_TYPES: DocumentType[] = [
  ...LP_DOCUMENT_TYPES,
  ...FUND_DOCUMENT_TYPES,
  "advisory_agreement",
  "other",
];
