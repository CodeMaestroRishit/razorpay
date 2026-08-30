create table transactions (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null references merchants(id),
  customer_id  uuid not null references customers(id),
  amount       bigint not null,       -- paise, never float
  currency     text not null default 'INR',
  status       text not null,         -- created | failed | succeeded | refunded
  gateway_ref  text unique,           -- idempotency anchor for this transaction
  created_at   timestamptz not null default now()
);
create index on transactions (merchant_id);
create index on transactions (customer_id);

-- Append-only: every attempt is a new row, never an update-in-place.
create table payments (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions(id),
  status         text not null,       -- failed | succeeded | pending | timed_out
  failure_code   text,                -- card_expired | insufficient_funds | bank_decline | ...
  attempted_at   timestamptz not null default now()
);
create index on payments (transaction_id);

create table subscriptions (
  id             uuid primary key default gen_random_uuid(),
  merchant_id    uuid not null references merchants(id),
  customer_id    uuid not null references customers(id),
  status         text not null,       -- active | past_due | cancelled
  next_charge_at timestamptz,
  created_at     timestamptz not null default now()
);
create index on subscriptions (merchant_id);

create table invoices (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null references merchants(id),
  customer_id  uuid not null references customers(id),
  amount       bigint not null,
  due_date     date not null,
  status       text not null,         -- open | overdue | paid | write_off
  created_at   timestamptz not null default now()
);
create index on invoices (merchant_id);
