-- Row-Level Security: the tenancy boundary for `recovery_app` (§13).
--
-- Local stand-in for Supabase auth.uid(): the API layer runs
--   SET LOCAL app.current_merchant_id = '<merchant uuid>';
-- at the start of every request, inside the same transaction as the
-- query. `recovery_service` (the backend's own pipeline connection) has
-- BYPASSRLS and ignores all of this, matching how a Supabase service-role
-- key bypasses RLS. Tables not listed here (webhook_events,
-- idempotency_keys, audit_logs) are simply never granted to recovery_app —
-- stricter than a policy, since there is no tenant column to scope them by.

grant usage on schema public to recovery_app;

create or replace function current_merchant_id() returns uuid as $$
  select nullif(current_setting('app.current_merchant_id', true), '')::uuid
$$ language sql stable;

-- merchants: a merchant can see its own row only.
alter table merchants enable row level security;
create policy merchant_self on merchants
  using (id = current_merchant_id());
grant select on merchants to recovery_app;

-- Direct merchant_id column: straightforward scoping.
do $$
declare
  t text;
begin
  foreach t in array array[
    'customers', 'transactions', 'subscriptions', 'invoices',
    'revenue_risk_events', 'recovery_cases', 'recovery_campaigns', 'policy_rules'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (merchant_id = current_merchant_id())', t
    );
    execute format('grant select on %I to recovery_app', t);
  end loop;
end
$$;

-- Joined tables: scoped via their parent's merchant_id.
alter table payments enable row level security;
create policy tenant_isolation on payments using (
  transaction_id in (select id from transactions where merchant_id = current_merchant_id())
);
grant select on payments to recovery_app;

alter table risk_scores enable row level security;
create policy tenant_isolation on risk_scores using (
  event_id in (select id from revenue_risk_events where merchant_id = current_merchant_id())
);
grant select on risk_scores to recovery_app;

alter table root_cause_analysis enable row level security;
create policy tenant_isolation on root_cause_analysis using (
  event_id in (select id from revenue_risk_events where merchant_id = current_merchant_id())
);
grant select on root_cause_analysis to recovery_app;

alter table recovery_actions enable row level security;
create policy tenant_isolation on recovery_actions using (
  case_id in (select id from recovery_cases where merchant_id = current_merchant_id())
);
grant select on recovery_actions to recovery_app;

alter table communication_attempts enable row level security;
create policy tenant_isolation on communication_attempts using (
  case_id in (select id from recovery_cases where merchant_id = current_merchant_id())
);
grant select on communication_attempts to recovery_app;

alter table promises_to_pay enable row level security;
create policy tenant_isolation on promises_to_pay using (
  case_id in (select id from recovery_cases where merchant_id = current_merchant_id())
);
grant select on promises_to_pay to recovery_app;

alter table escalations enable row level security;
create policy tenant_isolation on escalations using (
  case_id in (select id from recovery_cases where merchant_id = current_merchant_id())
);
grant select on escalations to recovery_app;

alter table agent_decisions enable row level security;
create policy tenant_isolation on agent_decisions using (
  case_id in (select id from recovery_cases where merchant_id = current_merchant_id())
);
grant select on agent_decisions to recovery_app;

alter table experiment_results enable row level security;
create policy tenant_isolation on experiment_results using (
  campaign_id in (select id from recovery_campaigns where merchant_id = current_merchant_id())
);
grant select on experiment_results to recovery_app;
