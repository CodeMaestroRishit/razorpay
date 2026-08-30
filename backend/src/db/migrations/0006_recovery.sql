create table recovery_campaigns (
  id             uuid primary key default gen_random_uuid(),
  merchant_id    uuid not null references merchants(id),
  name           text not null,
  started_at     timestamptz not null default now(),
  stopping_rules jsonb not null default '{}'
);

-- Cooldown enforcement lives off this table (§4 "Repeated customer messaging").
create table communication_attempts (
  id                 uuid primary key default gen_random_uuid(),
  case_id            uuid not null references recovery_cases(id),
  channel            text not null,   -- sms | email | voice | whatsapp
  language           text not null default 'en',
  message_text       text,
  codemix_transcript text,            -- what the customer actually said (voice replies)
  english_transcript text,            -- what the agent reasoned over (§8)
  audio_ref          text,            -- Storage URL, never the blob itself (§13 PII)
  sent_at            timestamptz not null default now(),
  cooldown_until     timestamptz not null
);
create index on communication_attempts (case_id);
create index on communication_attempts (channel, cooldown_until);

create table promises_to_pay (
  id             uuid primary key default gen_random_uuid(),
  case_id        uuid not null references recovery_cases(id),
  promised_date  date not null,
  status         text not null default 'pending' -- pending | kept | broken
);
create index on promises_to_pay (case_id);

create table escalations (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid not null references recovery_cases(id),
  reason       text not null,
  escalated_at timestamptz not null default now(),
  resolved_at  timestamptz
);
create index on escalations (case_id);
