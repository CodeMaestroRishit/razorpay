// Status colors per the dataviz skill's fixed status palette — distinct
// from any categorical/chart hue, always paired with a label (never
// color alone).
const STATE_STYLES: Record<string, string> = {
  recovered: "bg-[#E7F7E7] text-[#0ca30c]",
  escalated: "bg-[#FBEAEA] text-[#d03b3b]",
  closed_unrecovered: "bg-slate-100 text-slate-500",
  retry_scheduled: "bg-[#FFF6E0] text-[#8a6300]",
  contacting: "bg-brand-50 text-brand-dark",
  awaiting_approval: "bg-brand-50 text-brand-dark",
  recommending: "bg-slate-100 text-slate-600",
  diagnosing: "bg-slate-100 text-slate-600",
  detected: "bg-slate-100 text-slate-600",
};

export function StateBadge({ state }: { state: string }) {
  const style = STATE_STYLES[state] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${style}`}>
      {state.replace(/_/g, " ")}
    </span>
  );
}

export function PlaybookBadge({ playbook }: { playbook: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-navy/5 px-2.5 py-1 text-xs font-medium text-navy/70">
      {playbook.replace(/_/g, " ")}
    </span>
  );
}
