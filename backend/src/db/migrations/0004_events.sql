-- Raw inbound events before normalization. Keyed on provider_event_id so
-- redelivery is stored, not reprocessed (§4 "Webhook duplication").
create table webhook_events (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null,      -- 'razorpay' | 'synthetic'
  provider_event_id  text not null,
  payload            jsonb not null,
  processed          boolean not null default false,
  received_at        timestamptz not null default now(),
  unique (provider, provider_event_id)
);

-- The outbox (§7). Every inbound signal, once normalized, becomes exactly
-- one row here. The backend pipeline subscribes to inserts (poll or
-- LISTEN/NOTIFY locally; Supabase Realtime in production).
create table revenue_risk_events (
  id                uuid primary key default gen_random_uuid(),
  source_event_id   uuid references webhook_events(id),
  merchant_id       uuid not null references merchants(id),
  type              text not null,      -- payment_failed | checkout_abandoned | invoice_overdue | customer_responded | promise_to_pay_broken
  transaction_id    uuid references transactions(id),
  invoice_id        uuid references invoices(id),
  customer_id       uuid references customers(id),
  payload           jsonb not null default '{}',
  detected_at       timestamptz not null default now(),
  pipeline_status   text not null default 'pending' -- pending | processing | done | failed
);
create index on revenue_risk_events (merchant_id);
create index on revenue_risk_events (pipeline_status);

create table risk_scores (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references revenue_risk_events(id),
  score      numeric not null,   -- 0..1, deterministic function output (§9)
  factors    jsonb not null,     -- {factor: weight, ...} for explainability
  scored_at  timestamptz not null default now()
);
create index on risk_scores (event_id);
