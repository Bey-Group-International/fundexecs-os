-- Market Pulse notices in the Unified Inbox: the daily digest of new findings
-- and an alert for each high-fit find (lib/pulse.server.ts). Their own channel
-- so they are labelled and filterable apart from the Radar digest.
-- `add value if not exists` is idempotent.
alter type inbox_channel add value if not exists 'pulse';
