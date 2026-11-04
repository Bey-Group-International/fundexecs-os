# Naming the human gates

Every PE skill ends by naming the person who owns its gate, and never describes its output
as approved. Out of the box it names a generic role ("The deal lead", "The IC", "Counsel").
Once the firm names its owners, the skill names them instead.

## Set the owners

Open **Settings → PE department settings → Firm and gate owners** (owners and admins only) and
fill in the gates you want named:

```json
{
  "firmName": "Acme Capital",
  "gateOwners": {
    "first_look": "Jane Doe, deal lead",
    "bid_price": "Investment Committee"
  }
}
```

- Only the gates you write are changed; every other skill keeps its generic role.
- Unknown gate names and names over 120 characters are dropped, and the editor says so.
- A file with no firm name and no owner is not saved (the starter is all blanks on purpose).

## Which gate belongs to which skill

|         Gate key         |           Skill           |                   Gate                   |
|--------------------------|---------------------------|------------------------------------------|
| `mandate_screen`         | `mandate-screen`          | Mandate screen sign-off                  |
| `target_screen_review`   | `target-screen`           | Review of every pass before outreach     |
| `first_look`             | `first-look`              | Go / no-go on first look                 |
| `revenue_quality`        | `revenue-quality`         | Treatment of customer concentration      |
| `adjusted_ebitda`        | `qoe-bridge`              | Diligence-adjusted EBITDA                |
| `legal_findings`         | `legal-dd`                | Legal findings                           |
| `tax_exposures`          | `tax-dd`                  | Tax exposures before price or SPA        |
| `technology_risk_ratings` | `technology-dd`          | Technology risk ratings                  |
| `red_flag_treatment`     | `red-flag-register`       | Treatment of walk-away and price items   |
| `bid_price`              | `bid-range`               | Bid price                                |
| `sensitivity_basis`      | `sensitivity`             | Case the price rests on                  |
| `financing_structure`    | `financing-terms`         | Financing structure and lender selection |
| `compliance_certificate` | `covenant-watch`          | Compliance certificate                   |
| `kpi_trend_review`       | `kpi-variance`            | KPI trend classifications                |
| `cash_forecast`          | `cash-13-week`            | 13-week cash forecast                    |
| `exit_launch`            | `exit-readiness`          | Exit launch timing                       |
| `ipo_decision`           | `ipo-readiness`           | Decision to pursue a listing             |
| `exit_route`             | `exit-routes`             | Exit route                               |
| `data_room_redaction`    | `data-room-prep`          | Redaction list before the room opens     |
| `final_report_review`    | `final-investment-report` | Final investment report                  |

## How it reaches a skill

The skill's `gateOwner` input is filled from the firm file when the caller does not pass one,
both for runs started in a session and for steps the workflow planner runs as a skill. A
`gateOwner` passed in the call always wins. Nothing is invented: with no name saved, the
skill's labelled generic role stays.
