# Subscriptions

FundExecs owns the subscription lifecycle. A payment processor is a **charge
rail** — it moves money when we tell it to — not the system of record.

## Why

Before this, a "plan" was three columns on `wallets` (`plan`, `plan_interval`,
`plan_started_at`), written once at checkout and never touched again. That had
four consequences, all of them visible to paying operators:

|                           Symptom                            |                                             Cause                                              |
|--------------------------------------------------------------|------------------------------------------------------------------------------------------------|
| Cancelling in the Stripe portal left the plan active forever | Nothing in the product ever heard about it                                                     |
| Switching plans billed the operator twice                    | A plan change ran a fresh checkout, opening a *second* Stripe subscription                     |
| Renewals silently stopped after the first period             | Renewal credits only landed if the optional `STRIPE_WEBHOOK_SECRET` happened to be configured  |
| Checkout dead-ended on a modal that could not load           | Embedded Checkout needs `STRIPE_PUBLISHABLE_KEY`; with only a secret key there was no fallback |

None of these are processor bugs. They are the shape of a system that let an
external service hold state the product needed to reason about.

## Shape

```
lib/subscriptions.ts          pure state machine — period math, proration, dunning
lib/subscriptions.server.ts   the lifecycle against the DB
lib/billing-rail.ts           the seam where a period meets money
lib/stripe.ts                 the Stripe rail: collect a payment, save the card
app/api/cron                  the hourly sweep that makes plans actually recur
app/(app)/wallet              purchase, change, cancel, resume, billing history
```

Two tables (migration `20260907160000`):

- **`subscriptions`** — one live row per org, enforced by a partial unique index
  on `(organization_id) where status in ('active','past_due')`. That index is
  what makes double-billing *unrepresentable* rather than merely unlikely.
- **`subscription_events`** — append-only billing history. A unique index on
  `(subscription_id, reference) where kind = 'renewed'` means two overlapping
  cron sweeps cannot both book the same period.

Neither table has an RLS write policy. Members can read their org's rows;
every mutation goes through `lib/subscriptions.server` on the service role, so
nobody can hand themselves a plan or a period extension.

## Lifecycle

**Start.** Checkout collects the first period and saves the card
(`setup_future_usage: "off_session"`). Fulfillment calls `startSubscription`,
which grants the plan's credits and opens the period. If the org already has a
live subscription, this routes into `changePlan` instead of opening a second one.

**Renew.** The hourly sweep finds rows whose `current_period_end` has passed,
charges the rail, grants the plan credits plus the tenure bonus, and advances
the period. Periods are anchored on the subscription's original start date, so
a short February borrows the 28th and March gets the 31st back — and a sweep
that has been down for three cycles advances to the current period in *one*
step rather than billing three times for value never delivered.

**Change.** Upgrades apply immediately, charging only the price difference for
the unused remainder of the period and granting the matching prorated credits;
the period end does not move. Downgrades are scheduled for the next renewal —
credits already granted may already be spent, so cutting a plan short would
mean taking back value the operator paid for.

**Dunning.** A failed charge moves the row to `past_due` and schedules a retry
(1, 3, then 5 days). Access is not cut off on the first decline. After the last
retry the subscription closes and the entitlement drops.

**Cancel.** Always at period end — the period is paid for. `resume` withdraws
the cancellation while the period is still running.

## Configuration

|           Env            |                                                             Effect if unset                                                             |
|--------------------------|-----------------------------------------------------------------------------------------------------------------------------------------|
| `CRON_SECRET`            | **The sweep refuses to run and nothing renews.** Required in production.                                                                |
| `STRIPE_SECRET_KEY`      | The native rail settles in-app with no charge. The full lifecycle still runs, which is what makes local and demo environments faithful. |
| `STRIPE_PUBLISHABLE_KEY` | Checkout falls back to hosted Stripe instead of the in-app form. Purchases still work.                                                  |
| `STRIPE_WEBHOOK_SECRET`  | No effect on current subscriptions. Only legacy Stripe-managed rows depend on it.                                                       |

## Legacy Stripe-managed subscriptions

Orgs that subscribed under the old `mode: "subscription"` flow still have Stripe
billing them on Stripe's schedule. Those rows carry a
`processor_subscription_id`; the renewal sweep skips them and the webhook keeps
granting their renewals, so the two systems never both bill the same period.
They age out as those subscriptions end.
