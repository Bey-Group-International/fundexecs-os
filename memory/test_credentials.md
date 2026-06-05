# Test credentials

No test users have been provisioned in this environment.

## Phase 1 — §3H "The Team" identity carry-over

This phase did not require any auth-protected verification — the changes are presentation-only and live on auth-gated routes that render server-side without a session. No live DB writes were performed.

Phase 3 (DB-backed surfaces) will need real test accounts. For that we will need either:

- A working service-role key for the live Supabase project `emityvdaeiqxtpxdhyky` (custom domain `auth.fundexecs.com`). With it, I can self-provision one test account per member type via the admin client and record them here.
- Or human-provisioned accounts, one per member type:
  - `investment_firm`
  - `service_provider`
  - `startup`
  - `student`
  - `individual_investor`

Until then: **none**.
