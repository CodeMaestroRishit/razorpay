-- AI output, stored verbatim for audit. Never mutated.
create table root_cause_analysis (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references revenue_risk_events(id),
  cause       text not null,
  confidence  numeric not null,
  model_used  text not null,
  raw_output  jsonb not null,
  created_at  timestamptz not null default now()
);
create index on root_cause_analysis (event_id);

create table recovery_cases (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references revenue_risk_events(id),
  merchant_id uuid not null references merchants(id),
  customer_id uuid not null references customers(id),
  playbook    text not null,   -- failed_subscription | checkout_abandonment | b2b_receivables
  state       text not null,   -- see pipeline/stateMachine.ts for the full enum + transition table
  holdout     boolean not null default false, -- §11: holdout group gets no agent intervention
  opened_at   timestamptz not null default now(),
  closed_at   timestamptz
);
create index on recovery_cases (merchant_id);
create index on recovery_cases (state);

-- proposed_by: 'ai' when the LLM proposed it, 'policy_default' when the
-- guardrail engine fell back to a deterministic default (AI outage, §4/§14).
create table recovery_actions (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid not null references recovery_cases(id),
  action_type  text not null,
  proposed_by  text not null,
  status       text not null,   -- proposed | approved | rejected | executed | failed
  payload      jsonb not null default '{}',
  created_at   timestamptz not null default now()
);
create index on recovery_actions (case_id);

create table policy_rules (
  id          uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id),
  rule_type   text not null,   -- max_retry_count | min_retry_interval_hours | max_campaign_duration_days | cooldown_hours | amount_cap | allowed_action_types
  params      jsonb not null,
  updated_at  timestamptz not null default now(),
  unique (merchant_id, rule_type)
);

-- The core audit/timeline table. Every pipeline stage writes here.
-- This *is* the Agent Timeline UI's data source (§12) and the
-- observability layer (§14) — not an add-on log.
create table agent_decisions (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references recovery_cases(id),
  stage       text not null,   -- detect | score | root_cause | recommend | guardrail | idempotency | execute | measure | stop_or_escalate
  input       jsonb not null,
  output      jsonb not null,
  model       text,
  latency_ms  integer,
  created_at  timestamptz not null default now()
);
create index on agent_decisions (case_id);
create index on agent_decisions (stage);
