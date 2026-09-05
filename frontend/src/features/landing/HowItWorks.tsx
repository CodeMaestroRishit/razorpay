import { PipelineDiagram } from "./PipelineDiagram.js";

const GUARDRAIL_RULES: Array<{ n: number; rule: string; what: string }> = [
  { n: 1, rule: "schema", what: "Structural validation — unknown action types, extra fields, negative/NaN/fractional amounts, out-of-range confidence" },
  { n: 2, rule: "holdout", what: "A holdout case gets no intervention, so the recovery baseline stays a real measurement" },
  { n: 3, rule: "terminal_state", what: "Nothing acts on an already-recovered or closed case" },
  { n: 4, rule: "suspected_fraud", what: "Fraud is an unconditional escalation — outranks any confident AI proposal" },
  { n: 5, rule: "customer_opt_out", what: "Blocks contact once a customer opts out; still allows closing the case" },
  { n: 6, rule: "action_allowlist", what: "Per-playbook action enum — an unlisted action type is rejected outright" },
  { n: 7, rule: "state_machine", what: "The action must be legal from the case's current state" },
  { n: 8, rule: "action_budget", what: "A total-actions cap so alternating action types can't dodge the retry budget" },
  { n: 9, rule: "retry_budget", what: "max_retry_count — the model cannot argue past a fixed retry limit" },
  { n: 10, rule: "retry_interval", what: "min_retry_interval_hours — 3 allowed retries is not 3 retries in one minute" },
  { n: 11, rule: "campaign_duration", what: "A case cannot be worked forever" },
  { n: 12, rule: "amount", what: "Never more than the original transaction, never over the merchant's cap" },
  { n: 13, rule: "channel", what: "Channel must be merchant-enabled and one the customer is actually reachable on" },
  { n: 14, rule: "cooldown", what: "Per-channel cooldown — no repeated messaging inside the window" },
  { n: 15, rule: "confidence_floor", what: "A low-confidence proposal escalates instead of acting on a guess" },
];

export function HowItWorks() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-dark">Transparency</div>
      <h1 className="mt-3 font-display text-4xl font-bold text-ink sm:text-5xl">
        The AI proposes. The guardrail decides.
      </h1>
      <p className="mt-4 max-w-2xl text-slate-500">
        Nothing on this page is a simplification for a demo — it's the actual control flow in{" "}
        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm">backend/src/pipeline/</code>. Every stage
        writes to an append-only audit table; open any case in the Cases tab to see this exact sequence with real
        input and output attached.
      </p>

      <div className="mt-12 rounded-3xl border border-ink/10 bg-white p-6 shadow-card sm:p-10">
        <PipelineDiagram />
      </div>

      <div className="mt-16">
        <h2 className="font-display text-2xl font-bold text-ink">The 15 guardrail rules</h2>
        <p className="mt-2 text-slate-500">
          Run in this fixed order, fail-closed. Every rejection names the exact rule that fired — shown as a badge on
          the case's timeline, not buried in a log.
        </p>
        <div className="mt-6 overflow-x-auto rounded-2xl border border-ink/10 bg-white shadow-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">Rule</th>
                <th className="px-4 py-3 font-medium">What it enforces</th>
              </tr>
            </thead>
            <tbody>
              {GUARDRAIL_RULES.map((r) => (
                <tr key={r.rule} className="border-b border-ink/5 last:border-0">
                  <td className="px-4 py-3 tabular text-slate-400">{r.n}</td>
                  <td className="px-4 py-3">
                    <code className="rounded bg-gold-50 px-1.5 py-0.5 font-mono text-xs font-semibold text-gold-dark">
                      {r.rule}
                    </code>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{r.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-16 rounded-2xl bg-ink p-8 text-center">
        <div className="font-display text-2xl font-bold text-white">44 tests pin this file's behavior alone.</div>
        <p className="mx-auto mt-2 max-w-lg text-white/60">
          Including rule ordering (the most fundamental violation is the one reported) and a proof that
          customer-controlled text can never change what executes — a prompt-injection payload gets its
          message_draft dropped, not honored.
        </p>
      </div>
    </div>
  );
}
