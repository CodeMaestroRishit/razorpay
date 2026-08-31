-- Support for the hardened guardrail engine.

-- §10 stopping condition ("customer opts out") and §4 ("customer asks for
-- a human"). Without a column for this, an opt-out could only live in
-- prompt text — exactly the kind of rule that must be deterministic.
alter table customers add column if not exists contact_opt_out boolean not null default false;

-- Indexes for the guardrail's fact-gathering query and the case/timeline
-- API reads. Each one backs a specific ORDER BY / filter that would
-- otherwise be a sequential scan as the tables grow:

-- gatherGuardrailFacts: latest cooldown per (case, channel).
create index if not exists communication_attempts_case_channel_sent_idx
  on communication_attempts (case_id, channel, sent_at desc);

-- gatherGuardrailFacts: retry count, last retry time, total action budget.
create index if not exists recovery_actions_case_type_status_idx
  on recovery_actions (case_id, action_type, status);

-- gatherGuardrailFacts + /api/cases: newest root cause per event.
create index if not exists root_cause_analysis_event_created_idx
  on root_cause_analysis (event_id, created_at desc);

-- Agent Timeline reads every decision for one case in chronological order.
create index if not exists agent_decisions_case_created_idx
  on agent_decisions (case_id, created_at);

-- /api/cases joins cases -> events, and the funnel groups by merchant.
create index if not exists recovery_cases_event_idx on recovery_cases (event_id);
create index if not exists recovery_cases_merchant_state_idx on recovery_cases (merchant_id, state);

-- /api/cases: newest risk score per event.
create index if not exists risk_scores_event_scored_idx on risk_scores (event_id, scored_at desc);
