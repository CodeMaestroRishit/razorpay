import { useQuery } from "@tanstack/react-query";
import { api, formatInr } from "../../lib/api.js";
import { StateBadge, PlaybookBadge } from "../../components/ui/Badge.js";

export function CasesTable({ merchantId, onSelect }: { merchantId: string; onSelect: (caseId: string) => void }) {
  const cases = useQuery({ queryKey: ["cases", merchantId], queryFn: () => api.cases(merchantId) });

  if (cases.isLoading) return <div className="p-8 text-slate-400">Loading cases…</div>;
  if (cases.isError || !cases.data) {
    return <div className="p-8 text-[#d03b3b]">Failed to load cases — is the backend running and seeded?</div>;
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-navy">Recovery Cases</h1>
        <p className="mt-1 text-slate-500">Click a row to open its Agent Timeline — the audit trail, in detail.</p>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-navy/5 bg-white shadow-card">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-navy/5 text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-3 font-medium">Customer</th>
              <th className="px-5 py-3 font-medium">Playbook</th>
              <th className="px-5 py-3 font-medium">State</th>
              <th className="px-5 py-3 font-medium">Amount</th>
              <th className="px-5 py-3 font-medium">Risk</th>
              <th className="px-5 py-3 font-medium">Root cause</th>
              <th className="px-5 py-3 font-medium">Group</th>
            </tr>
          </thead>
          <tbody>
            {cases.data.map((c) => (
              <tr
                key={c.id}
                onClick={() => onSelect(c.id)}
                className="cursor-pointer border-b border-navy/5 last:border-0 hover:bg-brand-50/50"
              >
                <td className="px-5 py-3">
                  <div className="font-medium text-navy">{c.customer_name}</div>
                  <div className="text-xs text-slate-400">{c.email ?? c.phone}</div>
                </td>
                <td className="px-5 py-3">
                  <PlaybookBadge playbook={c.playbook} />
                </td>
                <td className="px-5 py-3">
                  <StateBadge state={c.state} />
                </td>
                <td className="tabular px-5 py-3 font-medium text-navy">{formatInr(Number(c.amount))}</td>
                <td className="tabular px-5 py-3 text-slate-500">
                  {c.risk_score ? Number(c.risk_score).toFixed(2) : "—"}
                </td>
                <td className="px-5 py-3 text-slate-500">{c.root_cause ?? "—"}</td>
                <td className="px-5 py-3">
                  {c.holdout ? (
                    <span className="text-xs text-slate-400">holdout</span>
                  ) : (
                    <span className="text-xs text-brand-dark">treated</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
