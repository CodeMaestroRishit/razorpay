import {
  IconRadar,
  IconGauge,
  IconBrain,
  IconSpark,
  IconShield,
  IconBolt,
  IconChart,
  IconLedger,
} from "../../components/ui/icons.js";

/**
 * Three roles, three colors, used identically here, in the teaser, and on
 * a real case's Agent Timeline: blue = the model proposes, coral = the
 * guardrail (the one stage that can refuse), neutral = deterministic
 * plumbing. The guardrail is "code" in the ownership sense, but giving it
 * its own role is the whole point of the diagram.
 */
type Owner = "code" | "AI" | "guardrail";

const OWNER_STYLES: Record<Owner, { dot: string; badge: string; label: string }> = {
  AI: { dot: "bg-brand text-white", badge: "bg-brand/10 text-brand", label: "AI proposes" },
  guardrail: { dot: "bg-accent text-white", badge: "bg-accent/15 text-accent-dark", label: "can say no" },
  code: { dot: "bg-ink/10 text-ink", badge: "bg-ink/10 text-ink/70", label: "deterministic" },
};

function StepRow({
  icon,
  title,
  owner,
  detail,
  last,
}: {
  icon: React.ReactNode;
  title: string;
  owner: Owner;
  detail: string;
  last?: boolean;
}) {
  return (
    <li className="relative flex gap-4 pb-8 pl-1 last:pb-0">
      {!last && <span className="absolute left-[19px] top-10 h-[calc(100%-1.5rem)] w-px bg-ink/10" />}
      <div className={`z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${OWNER_STYLES[owner].dot}`}>
        {icon}
      </div>
      <div>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-ink">{title}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${OWNER_STYLES[owner].badge}`}
          >
            {OWNER_STYLES[owner].label}
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-500">{detail}</p>
      </div>
    </li>
  );
}

/**
 * The actual §5 loop, not a marketing simplification of it. `compact`
 * trims it to the steps a landing-page reader needs to trust the claim
 * ("guardrail can say no"); the full version (default) is the real
 * branch-and-loop shape, for the page whose whole job is proving it.
 */
export function PipelineDiagram({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <ol className="p-3">
        <StepRow icon={<IconRadar />} owner="code" title="Detect" detail="A webhook lands; risk is scored by a fixed formula, not a model." />
        <StepRow icon={<IconBrain />} owner="AI" title="Diagnose & recommend" detail="The reasoning model proposes one action — structured JSON, never free text." />
        <StepRow icon={<IconShield />} owner="guardrail" title="Guardrail" detail="15 named rules evaluate the proposal. No model call inside this file." />
        <StepRow icon={<IconLedger />} owner="code" title="Execute & audit" detail="Approved actions run once, idempotently, and every stage is logged." last />
      </ol>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_auto_1fr]">
      <ol className="lg:col-span-3">
        <StepRow icon={<IconRadar />} owner="code" title="1. Detect" detail="A webhook (real Razorpay, or a scheduled sweep resuming a scheduled case) normalizes into a revenue_risk_events row." />
        <StepRow icon={<IconGauge />} owner="code" title="2. Score" detail="A fixed formula scores risk from failure code, amount, and prior retries — same inputs always produce the same score." />
        <StepRow icon={<IconBrain />} owner="AI" title="3. Diagnose" detail="The reasoning model infers a root cause from transaction metadata only. It never sees or proposes an action at this stage." />
        <StepRow icon={<IconSpark />} owner="AI" title="4. Recommend" detail="One structured proposal — action type, channel, draft message, confidence. No credential, no API client, no way to execute anything itself." />
      </ol>

      <div className="lg:col-span-3">
        <div className="rounded-2xl border-2 border-accent bg-accent-50 p-5">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white">
              <IconShield />
            </div>
            <div className="font-bold text-ink">5. Guardrail — the actual security boundary</div>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            15 named, ordered checks — schema validation, holdout enforcement, fraud/opt-out, action allowlist, the
            state machine, retry budget and interval, campaign duration, amount bounds, channel reachability,
            cooldown, confidence floor. Every rejection names the exact rule that fired. No model call anywhere in
            this file.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-white p-3">
              <div className="text-xs font-bold uppercase tracking-wide text-emerald-700">Approved →</div>
              <div className="mt-1 text-sm text-slate-600">
                Idempotency check, then execute exactly once. Retry, message, or escalate.
              </div>
            </div>
            <div className="rounded-xl bg-white p-3">
              <div className="text-xs font-bold uppercase tracking-wide text-rose-700">Rejected →</div>
              <div className="mt-1 text-sm text-slate-600">
                Case escalates to a human. The rejection reason is the audit trail entry — nothing silently drops.
              </div>
            </div>
          </div>
        </div>
      </div>

      <ol className="lg:col-span-3">
        <StepRow icon={<IconBolt />} owner="code" title="6. Execute" detail="Only ever runs a guardrail-approved action, gated by an idempotency key so a retried delivery can't double-charge or double-message." />
        <StepRow icon={<IconChart />} owner="code" title="7. Measure" detail="Outcome observed. A holdout group gets no intervention at all, so the recovery number is measured against a real baseline, not asserted." />
        <StepRow
          icon={<IconLedger />}
          owner="code"
          title="8. Audit"
          detail="Every stage above already wrote here. A case that isn't resolved returns to step 3 when its retry interval elapses (POST /internal/sweep) — this is what makes a second attempt possible at all."
          last
        />
      </ol>
    </div>
  );
}
