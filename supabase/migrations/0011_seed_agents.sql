-- 0011_seed_agents.sql
-- Seed the global six-agent catalog. Idempotent: safe to re-run.

insert into public.ai_agents (key, name, hub, role, color, motion_style, capabilities) values
  ('analyst', 'Analyst', 'run', 'Ingests deal data, financials, and market comps; produces pro formas and valuations.', '#22d3ee', 'precise, analytical', array['pro_forma','valuation','sensitivity','comps']),
  ('associate', 'Associate', null, 'Coordinates workflows and task execution across all hubs.', '#6366f1', 'coordinated, rhythmic', array['orchestration','routing','handoff','task_management']),
  ('investor_relations', 'Investor Relations', 'execute', 'Manages LP communications, capital calls, and reporting.', '#f59e0b', 'smooth, communicative', array['lp_comms','capital_calls','reporting']),
  ('portfolio_ops', 'Portfolio Ops', 'execute', 'Monitors asset KPIs, budgets, capex, and variance alerts.', '#22c55e', 'grounded, operational', array['kpis','budgets','capex','variance']),
  ('diligence', 'Diligence', 'run', 'Parses documents, flags risks, and produces diligence memos.', '#ef4444', 'sharp, investigative', array['doc_parsing','risk_flags','diligence_memo']),
  ('fund_admin', 'Fund Admin', 'execute', 'Handles waterfall calculations, fund accounting, and audit prep.', '#cbd5e1', 'structured, methodical', array['waterfall','fund_accounting','audit_prep'])
on conflict (key) do update set
  name = excluded.name,
  hub = excluded.hub,
  role = excluded.role,
  color = excluded.color,
  motion_style = excluded.motion_style,
  capabilities = excluded.capabilities;
