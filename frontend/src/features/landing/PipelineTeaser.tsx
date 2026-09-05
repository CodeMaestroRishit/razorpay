import { IconRadar, IconBrain, IconShield, IconBolt, IconLedger } from "../../components/ui/icons.js";

const STEPS = [
  { label: "Detect", icon: IconRadar, tag: "code" },
  { label: "Diagnose", icon: IconBrain, tag: "AI" },
  { label: "Guardrail", icon: IconShield, tag: "code" },
  { label: "Recover", icon: IconBolt, tag: "code" },
  { label: "Audit", icon: IconLedger, tag: "code" },
] as const;

/** Compact five-step summary used on the landing page, between the hero and the stats. */
export function PipelineTeaser() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-6 sm:gap-x-4">
      {STEPS.map((step, i) => (
        <div key={step.label} className="flex items-center">
          <div className="flex flex-col items-center gap-2">
            <div
              className={`flex h-14 w-14 items-center justify-center rounded-2xl ${
                step.label === "Guardrail" ? "bg-accent text-white" : "bg-ink text-brand"
              }`}
            >
              <step.icon />
            </div>
            <div className="text-center">
              <div className="text-sm font-semibold text-ink">{step.label}</div>
              <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{step.tag}</div>
            </div>
          </div>
          {i < STEPS.length - 1 && <div className="mx-2 hidden h-px w-8 bg-ink/15 sm:block sm:w-12" />}
        </div>
      ))}
    </div>
  );
}
