-- Follow-up to 20261101070000_lp_sessions_admin_only.sql (SOC 2 gap G-6).
--
-- That migration revoked the new view from public and anon, but Supabase's
-- default privileges had already granted signed-in users every privilege on a
-- new object, and "grant select" does not take the others away. A view over one
-- table is automatically updatable, so a plain member could have written LP
-- sessions in their own organization through it, which the table's admin-only
-- policies exist to prevent. Signed-in users get SELECT and nothing else.
revoke all on public.lp_onboarding_session_overview from authenticated;
grant select on public.lp_onboarding_session_overview to authenticated;
