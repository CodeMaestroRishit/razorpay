import { useEffect, useRef, useState } from "react";
import { api, formatInr, type TimelineEntry } from "../../lib/api.js";

/**
 * Fires one real synthetic event through the actual pipeline and polls its
 * timeline while the AI calls are genuinely in flight. This exists because
 * a pre-baked JSON dump doesn't read as real — watching the guardrail step
 * light up a beat after the recommendation, with real elapsed seconds
 * ticking, does.
 */
type Phase = "idle" | "starting" | "running" | "done" | "error";
type StepStatus = "pending" | "active" | "done" | "rejected";

const POLL_MS = 600;
const MAX_WAIT_MS = 20000;

function useElapsed(active: boolean) {
  const [ms, setMs] = useState(0);
  const startRef = useRef(0);
  useEffect(() => {
    if (!active) return;
    startRef.current = Date.now();
    setMs(0);
    const id = window.setInterval(() => setMs(Date.now() - startRef.current), 100);
    return () => window.clearInterval(id);
  }, [active]);
  return ms;
}

function Step({ label, status, detail, last }: { label: string; status: StepStatus; detail?: string; last?: boolean }) {
  const dotStyle =
    status === "done"
      ? "bg-[#0ca30c] text-white"
      : status === "rejected"
        ? "bg-accent text-white"
        : status === "active"
          ? "animate-pulse bg-brand text-white"
          : "bg-ink/10 text-ink/40";

  return (
    <li className="relative flex gap-3 pb-6 last:pb-0">
      {!last && <span className="absolute left-[11px] top-6 h-[calc(100%-1rem)] w-px bg-ink/10" />}
      <span className={`z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${dotStyle}`}>
        {status === "done" ? "✓" : status === "rejected" ? "!" : status === "active" ? "…" : ""}
      </span>
      <div>
        <div className="text-sm font-semibold text-ink">{label}</div>
        {detail && <div className="mt-0.5 text-sm text-slate-500">{detail}</div>}
        {status === "active" && !detail && <div className="mt-0.5 text-sm text-slate-400">working…</div>}
      </div>
    </li>
  );
}

export function LiveDemo({ merchantId }: { merchantId: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const generationRef = useRef(0);

  const running = phase === "starting" || phase === "running";
  const elapsed = useElapsed(running);

  useEffect(() => () => {
    if (pollRef.current) window.clearTimeout(pollRef.current);
  }, []);

  async function run() {
    if (pollRef.current) window.clearTimeout(pollRef.current);
    const myGeneration = ++generationRef.current;

    setError(null);
    setEntries([]);
    setCaseId(null);
    setPhase("starting");

    try {
      const { caseId: id } = await api.demoTrigger(merchantId);
      if (myGeneration !== generationRef.current) return;
      setCaseId(id);
      setPhase("running");

      const startedAt = Date.now();
      const poll = async () => {
        if (myGeneration !== generationRef.current) return;
        try {
          const data = await api.timeline(merchantId, id);
          if (myGeneration !== generationRef.current) return;
          setEntries(data);
          const stages = new Set(data.map((e) => e.stage));
          const terminal = stages.has("measure") || stages.has("stop_or_escalate");
          if (terminal || Date.now() - startedAt > MAX_WAIT_MS) {
            setPhase("done");
            return;
          }
          pollRef.current = window.setTimeout(poll, POLL_MS);
        } catch (err) {
          if (myGeneration !== generationRef.current) return;
          setError(err instanceof Error ? err.message : "polling failed");
          setPhase("error");
        }
      };
      poll();
    } catch (err) {
      if (myGeneration !== generationRef.current) return;
      setError(err instanceof Error ? err.message : "trigger failed");
      setPhase("error");
    }
  }

  const byStage = Object.fromEntries(entries.map((e) => [e.stage, e]));
  const detect = byStage.detect;
  const rootCause = byStage.root_cause;
  const recommend = byStage.recommend;
  const guardrail = byStage.guardrail;
  const escalate = byStage.stop_or_escalate;
  const measure = byStage.measure;

  const detectEvent = (detect?.input as { event?: { type?: string; payload?: { amount?: number } } } | undefined)?.event;
  const rootCauseOut = rootCause?.output as { cause?: string; confidence?: number } | undefined;
  const recommendOut = recommend?.output as { action_type?: string; confidence?: number } | undefined;
  const guardrailOut = guardrail?.output as { approved?: boolean; rule?: string; reason?: string } | undefined;
  const escalateOut = escalate?.output as { rule?: string } | undefined;
  const measureOut = measure?.output as { outcomeState?: string } | undefined;

  const steps: { label: string; status: StepStatus; detail?: string }[] = [
    {
      label: "Detect",
      status: detect ? "done" : running ? "active" : "pending",
      detail: detectEvent ? `${detectEvent.type} · ${formatInr(detectEvent.payload?.amount ?? 0)}` : undefined,
    },
    {
      label: "Diagnose (AI)",
      status: rootCause ? "done" : detect ? "active" : "pending",
      detail: rootCauseOut ? `${rootCauseOut.cause} · ${Math.round((rootCauseOut.confidence ?? 0) * 100)}% confidence` : undefined,
    },
    {
      label: "Recommend (AI)",
      status: recommend ? "done" : rootCause ? "active" : "pending",
      detail: recommendOut ? `proposes ${recommendOut.action_type} · ${Math.round((recommendOut.confidence ?? 0) * 100)}% confidence` : undefined,
    },
    {
      label: "Guardrail",
      status: guardrail ? (guardrailOut?.approved ? "done" : "rejected") : recommend ? "active" : "pending",
      detail: guardrail ? (guardrailOut?.approved ? "approved — all policy checks passed" : `rejected — ${guardrailOut?.rule}`) : undefined,
    },
    guardrailOut?.approved === false
      ? { label: "Escalated to a human", status: (escalate ? "rejected" : "active") as StepStatus, detail: escalateOut ? `rule: ${escalateOut.rule}` : undefined }
      : {
          label: "Execute & measure",
          status: (measure ? "done" : guardrail ? "active" : "pending") as StepStatus,
          detail: measureOut ? `outcome: ${measureOut.outcomeState}` : undefined,
        },
  ];

  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-6 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">Watch it happen, live</h2>
          <p className="mt-1 text-sm text-slate-500">
            Fires one real synthetic event through the actual pipeline — a real model call, a real guardrail
            evaluation, real latency. Not a replay of stored JSON.
          </p>
        </div>
        <button
          onClick={run}
          disabled={running}
          className="shrink-0 rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-60"
        >
          {running ? `Running… ${(elapsed / 1000).toFixed(1)}s` : "Trigger a live case"}
        </button>
      </div>

      {error && <div className="mt-4 rounded-lg bg-[#FBEAEA] px-4 py-3 text-sm text-[#d03b3b]">{error}</div>}

      {phase !== "idle" && phase !== "error" && (
        <ol className="mt-6">
          {steps.map((s, i) => (
            <Step key={s.label} label={s.label} status={s.status} detail={s.detail} last={i === steps.length - 1} />
          ))}
        </ol>
      )}

      {phase === "done" && caseId && (
        <p className="mt-4 text-xs text-slate-400">
          Case <code className="rounded bg-slate-100 px-1 font-mono">{caseId.slice(0, 8)}…</code> now appears in the
          Cases tab with its full audit trail.
        </p>
      )}
    </div>
  );
}
