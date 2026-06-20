-- Operators can ACCEPT a plan as the recommendation (the plan stands as the
-- deliverable, no agents run) — distinct from APPROVE & automate.
alter type approval_decision add value if not exists 'accepted';
