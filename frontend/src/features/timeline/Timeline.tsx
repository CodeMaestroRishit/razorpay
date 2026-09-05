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

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  hinglish: "Hinglish",
  ta: "Tamil",
  bn: "Bengali",
  mr: "Marathi",
  te: "Telugu",
  gu: "Gujarati",
  kn: "Kannada",
  ml: "Malayalam",
};
const ENGLISH_ALIASES = new Set(["en", "eng", "english"]);

function StageRow({ entry }: { entry: import("../../lib/api.js").TimelineEntry }) {
  const [open, setOpen] = useState(false);
  const output = entry.output as { approved?: boolean; rule?: string; reason?: string } | null;
  const isGuardrail = entry.stage === "guardrail";
  const isGuardrailReject = isGuardrail && output?.approved === false;
  const isGuardrailPass = isGuardrail && output?.approved === true;
  const isAiStage = entry.stage === "root_cause" || entry.stage === "recommend";

  const executeDetail =
    entry.stage === "execute"
      ? ((entry.output as { detail?: Record<string, unknown> } | null)?.detail as
          | { language?: string; englishDraft?: string; localizedText?: string; degraded?: boolean; channel?: string }
          | undefined)
      : undefined;
  const isLocalizedMessage =
    !!executeDetail?.language &&
    !ENGLISH_ALIASES.has(executeDetail.language.toLowerCase()) &&
    !!executeDetail.localizedText;

  // Same color roles as the pipeline diagram on the marketing pages, so a
  // judge who read "how it works" recognizes them here: blue = AI-owned
  // stage, coral = the guardrail, neutral = deterministic plumbing.
  const dotStyle = isGuardrailReject
    ? "bg-[#FBEAEA] text-[#d03b3b]"
    : isGuardrail
      ? "bg-accent text-white"
      : isAiStage
        ? "bg-brand text-white"
        : "bg-ink/10 text-ink";

  return (
    <li className="relative pb-8 pl-10">
      <span className={`absolute left-0 top-1 flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${dotStyle}`}>
        ●
      </span>
      <span className="absolute left-[11px] top-7 h-full w-px bg-ink/10" />
      <div className="flex items-baseline justify-between gap-4">
        <div className="font-semibold text-ink">{STAGE_LABELS[entry.stage] ?? entry.stage}</div>
        <div className="text-xs text-slate-400">
          {new Date(entry.created_at).toLocaleTimeString()} {entry.latency_ms ? `· ${entry.latency_ms}ms` : ""}
        </div>
      </div>
      {isGuardrailReject && (
        <div className="mt-1.5">
          {/* The rule name is the point: a merchant can see exactly which
              limit stopped the action, not just that something did. */}
          <span className="inline-flex items-center rounded-md bg-[#FBEAEA] px-2 py-0.5 font-mono text-[11px] font-semibold text-[#d03b3b]">
            {output?.rule ?? "rejected"}
          </span>
          <div className="mt-1 text-sm text-[#d03b3b]">{output?.reason}</div>
        </div>
      )}
      {isGuardrailPass && (
        <div className="mt-1 text-sm text-[#0ca30c]">approved — all policy checks passed</div>
      )}
      {isLocalizedMessage && (
        <div className="mt-2 rounded-lg border border-brand/20 bg-brand-50 p-3">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-brand-dark">
            <span>Localized via Sarvam</span>
            <span className="rounded-full bg-brand px-2 py-0.5 text-[10px] text-white">
              {LANGUAGE_NAMES[executeDetail!.language!.toLowerCase()] ?? executeDetail!.language}
            </span>
            {executeDetail?.degraded && (
              <span className="rounded-full bg-[#FFF6E0] px-2 py-0.5 text-[10px] text-[#8a6300]">fell back to English</span>
            )}
          </div>
          <div className="mt-2 text-xs text-slate-500">English draft</div>
          <div className="text-sm text-slate-600">{executeDetail?.englishDraft}</div>
          <div className="mt-2 text-xs text-slate-500">
            Sent {executeDetail?.channel ? `via ${executeDetail.channel}` : ""}
          </div>
          <div className="text-sm font-medium text-ink" lang={executeDetail?.language}>
            {executeDetail?.localizedText}
          </div>
        </div>
      )}
      <button onClick={() => setOpen((o) => !o)} className="mt-1 text-xs font-medium text-brand hover:underline">
        {open ? "hide details" : "show input / output"}
      </button>
      {open && (
        <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-ink-900 p-3 text-xs text-slate-100">
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
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/30" onClick={onClose}>
      <div className="h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold text-ink">Agent Timeline</h2>
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
