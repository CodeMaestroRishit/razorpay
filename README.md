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
is the only thing that turns a proposal into permission to act, and it's
plain, synchronous, unit-tested TypeScript with no model call inside it —
see `backend/test/guardrail.test.ts` for the 13 cases that pin its behavior
(allowlist enforcement, retry/amount/cooldown limits, confidence floor,
state validation, prompt-injection inertness).

## Stack

- **Backend:** Node/Express + TypeScript, hosting the entire pipeline as one
  process (no broker, no workflow engine — see §7/§19 of the architecture doc
  for why).
- **Database:** Postgres, with the exact §6 schema and real Row-Level
  Security (`recovery_app` role, tenant-scoped; `recovery_service` bypasses
  RLS the way a Supabase service-role key would). Runs against local
  Postgres via Docker by default — swap the connection strings for a real
  Supabase project whenever you have one; nothing else changes.
- **Frontend:** React + Vite + Tailwind + TanStack Query + Recharts.
- **External services (Anthropic / Sarvam / Razorpay):** every adapter in
  `backend/src/adapters/` falls back to a deterministic mock when its API
  key is unset, so the full pipeline runs end-to-end with zero external
  accounts. Drop in real keys later — no code changes needed.

## Quickstart

```bash
npm install                 # installs both workspaces
npm run db:up                # starts local Postgres (docker compose)
npm run migrate              # applies backend/src/db/migrations/*.sql
npm run seed                  # drives 50 synthetic events through the REAL pipeline
                               # — prints a merchant UUID, use it below

npm run dev:backend          # http://localhost:4000
npm run dev:frontend         # http://localhost:5173 — paste the merchant UUID when prompted
```

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
| Holdout group + §11 incrementality funnel | Real — derived from case state, not a partially-populated side table |
| Reasoning LLM (root cause + recommendation) | Real Anthropic call if `ANTHROPIC_API_KEY` set; deterministic mock otherwise |
| Sarvam (STT/TTS/Hinglish generation) | Real call if `SARVAM_API_KEY` set; English-template fallback otherwise (flagged as `degraded: true`, per §8) |
| Razorpay payment retry | Real test-mode API if keys set; seeded-random mock otherwise |
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

## Known gaps (next up)

- Frontend hardcodes `/api` (relies on the Vite dev proxy) — needs an env
  var for a deployed backend URL.
- `promise_to_pay_broken` re-checks (§10) aren't wired to a scheduler yet —
  the pipeline handles the event type if it arrives, but nothing polls
  `promises_to_pay` for broken promises on its own.
- No auth layer — `x-merchant-id` header stands in for what a real session
  would derive; swap for real auth before this goes anywhere near prod.
