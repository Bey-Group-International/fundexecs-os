# The firm's PE settings: what each file controls

The eight settings files live at **Settings → PE department settings** (owners and admins edit;
everyone in the org can read). Each is checked when you save: what is stored is the cleaned-up value,
and anything that was ignored is listed back to you. Anything you leave unset runs on a labelled
standing default, and the skill's output says so.

|         File         |                                         What it holds                                          |                               Read by                                |
|----------------------|------------------------------------------------------------------------------------------------|----------------------------------------------------------------------|
| Investment mandate   | hard limits, scored preferences, kill facts, each with a number; approved by an owner or admin | `mandate-screen`, `target-screen`, `first-look`                      |
| Return hurdles       | base and downside IRR / MOIC, hold period                                                      | `bid-range`, `sensitivity`, `exit-routes`, `final-investment-report` |
| Financing limits     | leverage limits, covenant warning %, liquidity minimum, call protection                        | `covenant-watch`, `cash-13-week`, `financing-terms`                  |
| KPI materiality      | % of budget, optional absolute floor, optional trend test                                      | `kpi-variance`                                                       |
| Firm and gate owners | firm name and who owns each human gate                                                         | all 21 PE skills (see [pe-gate-owners.md](./pe-gate-owners.md))      |
| Evidence grades      | which grades (A, B, C) may support a price; U never can                                        | `red-flag-register`, `technology-dd`                                 |
| IC memo structure    | sections, order, titles, which are required                                                    | `ic-memo`                                                            |
| Reporting style      | currency, units, decimals and labels for the LP update                                         | `lp-update`                                                          |

## Evidence grades

```json
{ "supportsPrice": { "A": true, "B": true, "C": false } }
```

- Default: A and B can support a price; C and U cannot. Set any of A, B, C; unset ones keep the default.
- **U (untested) is locked off.** An untested claim can appear as a risk or a question, never as a fact or a price.
- A price claim resting on a grade your policy does not allow is left out of the price adjustment and
  listed separately in the red flag register.

## IC memo structure

```json
{ "sections": [
  { "key": "recommendation", "title": "Recommendation", "required": true },
  { "key": "investment_thesis" },
  { "key": "structure", "title": "Structure", "required": true }
] }
```

- The skill can generate twelve sections: `executive_summary`, `recommendation`, `transaction_overview`,
  `investment_thesis`, `market`, `financials_valuation`, `returns`, `key_risks`, `mitigants`,
  `open_items`, `conditions_precedent`, `decision_history`. A known key needs no title.
- Any other key (a section the skill cannot write, such as `structure`, `asks`, `source_ledger`) needs
  a title and appears as an **open placeholder** to fill in by hand. Nothing is invented for it.
- Sections you leave out are not emitted. A `required` section that is still open is reported in
  `requiredOpen` and in the memo's open items.
- Up to 30 sections; keys are lowercase letters, digits and underscores; titles up to 80 characters.
- The starter is the skill's own twelve sections, so saving it changes nothing.

## Reporting style

```json
{ "currency": "USD", "units": "m", "decimals": 1, "labels": { "netIrr": "Net IRR (net of fees)" } }
```

- Presentation only. It never changes a value or converts units: `units` labels what the number you
  supplied is in, and `decimals` only controls how many decimals are shown.
- A one-character unit attaches ("USD 120.5m"); a word is spaced ("USD 120.5 million").
- Labels can be set for `nav`, `dpi`, `tvpi`, `netIrr`.

