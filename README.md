# AI Revenue Recovery

Razorpay `/buildathon` — Track 03. Implementation of the Hybrid AI Agent
architecture (Architecture D) from
[`razorpay-revenue-recovery-architecture.md`](./razorpay-revenue-recovery-architecture.md) —
read that doc first; this README is just "how do I run it."

```
Detect → Score (deterministic) → Root cause (AI) → Recommend (AI)
  → Guardrail (deterministic) → Idempotency check → Execute → Measure → Audit
```

The one property everything else is built around: **the AI never gets a code
path to a payment or messaging provider.** It returns a structured
`AiRecommendation` object; [`backend/src/pipeline/guardrail.ts`](./backend/src/pipeline/guardrail.ts)
is the only thing that turns a proposal into permission to act.

## The guardrail engine

Three properties make it the actual security boundary rather than a
decorative one:

1. **No model call, ever.** Nothing in the file is async or network-bound.
   Every fact it needs is passed in (`GuardrailFacts`, gathered in one
   query by [`guardrailFacts.ts`](./backend/src/pipeline/guardrailFacts.ts)),
   so the engine is a pure function — same inputs, same verdict, fully
   testable with no database.
2. **It does not trust its input.** `AiRecommendation` is a compile-time
   fiction; at runtime the object came from a model. Rule 1 re-validates the
   structure against a Zod schema, and `.strict()` means a model that
   invents `{"execute_now": true}` is refused rather than having the field
   silently ignored.
3. **It returns a normalized action, not the model's object.** An approved
   verdict carries a *rebuilt* action — unknown fields dropped, amount
   defaulted and clamped, message truncated. The executor never sees raw
   model output.

Rules run in a fixed order, fail-closed, and every rejection names the rule
that fired so the audit trail and UI can show a merchant exactly what
stopped an action:

| # | Rule | What it enforces |
|---|---|---|
| 1 | `schema` | Structural validation; unknown action types, extra fields, negative/NaN/fractional amounts, out-of-range confidence |
| 2 | `holdout` | A holdout case gets no intervention, so the §11 baseline stays a real measurement |
| 3 | `terminal_state` | Nothing acts on an already-recovered or closed case |
| 4 | `suspected_fraud` | Fraud is an unconditional escalation (§10) — outranks any confident AI proposal |
| 5 | `customer_opt_out` | Blocks contact once a customer opts out; still allows winding the case down |
| 6 | `action_allowlist` | Per-playbook action enum (§4 "AI hallucinates an action") |
| 7 | `state_machine` | The action must be legal from the case's current state |
| 8 | `action_budget` | Total-actions cap, so alternating action types can't dodge the retry budget |
| 9 | `retry_budget` | `max_retry_count` (§4 "infinite retry loops") |
| 10 | `retry_interval` | `min_retry_interval_hours` — 3 allowed retries is not 3 retries in one minute (§10) |
| 11 | `campaign_duration` | A case cannot be worked forever |
| 12 | `amount` | Never more than the original transaction, never over the merchant cap |
| 13 | `channel` | Channel must be merchant-enabled *and* one the customer is reachable on |
| 14 | `cooldown` | Per-channel cooldown (§4 "repeated customer messaging") |
| 15 | `confidence_floor` | Low-confidence proposals escalate instead of acting on a guess |

44 unit tests in [`backend/test/guardrail.test.ts`](./backend/test/guardrail.test.ts)
pin this behavior, including rule *ordering* (the most fundamental
violation is the one reported) and the fact that customer-controlled text
can never change what executes.

## Stack

- **Backend:** Node/Express + TypeScript, hosting the entire pipeline as one
  process (no broker, no workflow engine — see §7/§19 of the architecture doc
  for why).
- **Database:** Postgres, with the exact §6 schema and real Row-Level
  Security (`recovery_app` role, tenant-scoped; `recovery_service` bypasses
  RLS the way a Supabase service-role key would). Ships with a real
  Supabase project (`razorpay-revenue-recovery`, `ap-south-1`) — migrated
  and seeded already. Local Postgres via Docker also works identically
  (same migrations, same roles); switch by pointing `backend/.env` at
  either.

  Supabase's direct `db.<ref>.supabase.co` host is IPv6-only on the free
  tier and may not resolve on every network — `backend/.env` connects via
  the Supavisor pooler (`aws-0-ap-south-1.pooler.supabase.com:5432`,
  session mode) instead, which session-mode `SET LOCAL`-based RLS (this
  project's tenancy pattern) requires anyway.
- **Frontend:** React + Vite + Tailwind + TanStack Query + Recharts.
- **External services (Anthropic / Sarvam / Razorpay):** every adapter in
  `backend/src/adapters/` falls back to a deterministic mock when its API
  key is unset, so the full pipeline runs end-to-end with zero external
  accounts. Drop in real keys later — no code changes needed.

## Quickstart

`backend/.env` isn't committed (it holds real Supabase credentials). On a
fresh clone, either ask for that file, or point it at local Postgres
instead — copy `backend/.env.example` to `backend/.env` and run:

```bash
npm install                 # installs both workspaces
npm run db:up                # starts local Postgres (docker compose)
npm run migrate              # applies backend/src/db/migrations/*.sql
npm run seed                  # drives 50 synthetic events through the REAL pipeline
                               # — prints a merchant UUID, use it below

npm run dev:backend          # http://localhost:4000
npm run dev:frontend         # http://localhost:5173 — paste the merchant UUID when prompted
```

With the real `backend/.env` in place, skip `db:up`/`migrate` (already
applied to Supabase) and go straight to `npm run seed` (creates a fresh
merchant there) then the two `dev:*` commands.

Run the backend test suite (guardrail engine, state machine, risk scoring):

```bash
npm run test:backend
```

To use real external services, copy `backend/.env.example` to
`backend/.env` and fill in whichever keys you have — each is independently
optional.

## What's real vs. what's mocked

| Piece | Status |
|---|---|
| Full pipeline (detect → guardrail → execute → audit) | Real, runs end-to-end |
| Guardrail engine + policy rules | Real, unit-tested |
| Postgres schema + RLS (tenant isolation) | Real — verified with two seeded merchants; wrong/missing `x-merchant-id` returns 400/empty, never another tenant's rows |
| Idempotency keys | Real |
| Case state machine | Real |
| Holdout group + §11 incrementality funnel | Real — derived from case state (in-flight cases stay in the denominator), and the funnel reports its own sample sizes plus a flag when the holdout arm is too small to support the claim |
| Reasoning LLM (root cause + recommendation) | Real Anthropic call if `ANTHROPIC_API_KEY` set; deterministic mock otherwise |
| Sarvam (STT/TTS/Hinglish generation) | Real call if `SARVAM_API_KEY` set; English-template fallback otherwise (flagged as `degraded: true`, per §8) |
| Razorpay payment retry | Real test-mode API for genuine `pay_...` references; synthetic seed data routes to the mock even when keys are set, so demo data never hits the live payments API |
| Messaging send | Always a logged no-op (§17 Phase 4 — swap `adapters/messaging.ts` for a real provider when ready) |
| Live voice calls, Temporal, event broker | Not built — explicitly out of scope per §15/§19 |

## Project structure

```
backend/src/
  db/migrations/     §6 schema, in order, as plain SQL
  adapters/          llm.ts, sarvam.ts, razorpay.ts, messaging.ts — each real+mock
  pipeline/           one file per named stage in the §5 loop + audit.ts (agent_decisions)
  state/              stateMachine.ts — the §10 transition table, enforced not just diagrammed
  policy/             rules.ts — per-playbook limits, read fresh every call
  webhooks/           receiver.ts, verifySignature.ts
  api/                Express server + routes (cases, dashboard, webhooks)
  seed/               seed.ts — synthetic data driven through the real pipeline
frontend/src/
  features/dashboard  Executive Dashboard (funnel, treated-vs-holdout chart)
  features/cases      Recovery Cases table
  features/timeline   Agent Timeline — doubles as the Audit Trail (§12)
```

## Deploying

The two halves deploy differently, and it matters:

- **Backend → Render, as a Web Service (not a serverless/static option).**
  The webhook handler responds `202` and then keeps processing the
  pipeline after the response is sent; anything serverless would be frozen
  or killed at return, silently dropping that work — a Web Service is a
  persistent process, which is what this needs.

  [`render.yaml`](./render.yaml) at the repo root is a Blueprint: in the
  Render dashboard, **New → Blueprint**, point it at this repo, and it
  fills in root directory (`backend`), build (`npm install && npm run
  build`), start (`npm start`), and the health check (`/health`)
  automatically. It'll prompt you for the env vars marked `sync: false` —
  paste in `SERVICE_DATABASE_URL` and `APP_DATABASE_URL` from your
  `backend/.env`, plus whichever API keys you're using. Leave
  `CORS_ORIGINS` blank until the frontend is deployed (see below), then
  come back and set it.

  Without a blueprint: New → Web Service → root directory `backend`,
  build `npm install && npm run build`, start `npm start`.

- **Frontend → Vercel.** Root directory `frontend`, build `npm run build`,
  output `dist`. Set `VITE_API_BASE_URL` to the Render service's URL
  **plus `/api`** (e.g. `https://razorpay-revenue-recovery-backend.onrender.com/api`)
  — it's read at build time, so redeploy after changing it.

Once both are up, go back to the Render service's env vars and set
`CORS_ORIGINS` to the Vercel URL, so the backend actually accepts requests
from it. Never commit `backend/.env` — it holds live database credentials.

Render's free tier spins the service down after 15 minutes idle and takes
~30–60s to wake on the next request — expect that delay on a cold demo
load, or upgrade the plan if the buildathon judging can't tolerate it.

The Razorpay webhook URL is then the Render service's URL —
`https://<your-service>.onrender.com/webhooks/razorpay` — and the secret
you enter in the Razorpay dashboard goes in `RAZORPAY_WEBHOOK_SECRET`.

## Known gaps (next up)

- `promise_to_pay_broken` re-checks (§10) aren't wired to a scheduler yet —
  the pipeline handles the event type if it arrives, but nothing polls
  `promises_to_pay` for broken promises on its own.
- No auth layer — `x-merchant-id` header stands in for what a real session
  would derive; swap for real auth before this goes anywhere near prod.
- Frontend bundle is one 566 kB chunk (Recharts dominates). Fine for a
  dashboard behind auth; code-split before it faces the open internet.
- Sarvam's live path is written against the documented REST shape but has
  only been exercised in fallback mode — verify the response parsing
  against a real key before relying on the Hinglish output.
