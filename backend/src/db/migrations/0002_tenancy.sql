create table merchants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  config      jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create table customers (
  id             uuid primary key default gen_random_uuid(),
  merchant_id    uuid not null references merchants(id),
  name           text,
  phone          text,
  email          text,
  language_pref  text not null default 'en', -- 'en' | 'hi' | 'hinglish' | ...
  created_at     timestamptz not null default now()
);
create index on customers (merchant_id);
