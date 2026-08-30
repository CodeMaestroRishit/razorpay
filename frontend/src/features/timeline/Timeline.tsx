import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../lib/api.js";

const STAGE_LABELS: Record<string, string> = {
  detect: "Detected",
  root_cause: "Root cause analysis (AI)",
  recommend: "Recommendation (AI)",
  guardrail: "Guardrail validation",
  execute: "Executed",
  measure: "Outcome measured",
  stop_or_escalate: "Stop / Escalate",
};

function StageRow({ entry }: { entry: import("../../lib/api.js").TimelineEntry }) {
  const [open, setOpen] = useState(false);
  const isGuardrailReject =
    entry.stage === "guardrail" && (entry.output as { approved?: boolean } | null)?.approved === false;

  return (
    <li className="relative pb-8 pl-10">
      <span
        className={`absolute left-0 top-1 flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
          isGuardrailReject ? "bg-[#FBEAEA] text-[#d03b3b]" : "bg-brand-50 text-brand-dark"
        }`}
      >
        ●
      </span>
      <span className="absolute left-[11px] top-7 h-full w-px bg-navy/10" />
      <div className="flex items-baseline justify-between gap-4">
        <div className="font-semibold text-navy">{STAGE_LABELS[entry.stage] ?? entry.stage}</div>
        <div className="text-xs text-slate-400">
          {new Date(entry.created_at).toLocaleTimeString()} {entry.latency_ms ? `· ${entry.latency_ms}ms` : ""}
        </div>
      </div>
      {isGuardrailReject && (
        <div className="mt-1 text-sm text-[#d03b3b]">
          rejected: {(entry.output as { reason?: string }).reason}
        </div>
      )}
      <button onClick={() => setOpen((o) => !o)} className="mt-1 text-xs font-medium text-brand-dark hover:underline">
        {open ? "hide details" : "show input / output"}
      </button>
      {open && (
        <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-navy-950 p-3 text-xs text-slate-100">
          {JSON.stringify({ input: entry.input, output: entry.output, model: entry.model }, null, 2)}
        </pre>
      )}
    </li>
  );
}

export function Timeline({ merchantId, caseId, onClose }: { merchantId: string; caseId: string; onClose: () => void }) {
  const timeline = useQuery({
    queryKey: ["timeline", merchantId, caseId],
    queryFn: () => api.timeline(merchantId, caseId),
  });

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-navy/30" onClick={onClose}>
      <div className="h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-navy">Agent Timeline</h2>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100" aria-label="Close">
            ✕
          </button>
        </div>
        {timeline.isLoading && <div className="text-slate-400">Loading…</div>}
        {timeline.isError && <div className="text-[#d03b3b]">Failed to load timeline.</div>}
        {timeline.data && (
          <ol>
            {timeline.data.map((entry, i) => (
              <StageRow key={i} entry={entry} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
