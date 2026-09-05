import { StageChip } from "../../components/ui/StageChip.js";
import {
  IconRadar,
  IconGauge,
  IconBrain,
  IconSpark,
  IconShield,
  IconBolt,
  IconChart,
  IconLedger,
  IconArrowUpRight,
} from "../../components/ui/icons.js";
import { PipelineTeaser } from "./PipelineTeaser.js";
import { PipelineDiagram } from "./PipelineDiagram.js";

// Four corner clusters, two chips each, diagonally offset — deliberately
// nothing between roughly x=18%-82% at any height, which is the column
// the eyebrow/headline/subtitle/buttons occupy. Overlap here was a real
// bug found by actually screenshotting the page, not assumed away.
const CHIPS = [
  { label: "Detect", icon: <IconRadar />, gradient: "bg-gradient-to-br from-ink-900 to-ink", rotate: -8, style: { left: "2%", top: "4%" } },
  { label: "Score", icon: <IconGauge />, gradient: "bg-gradient-to-br from-brand-dark to-brand", rotate: 6, style: { left: "15%", top: "20%" } },
  { label: "Recommend", icon: <IconSpark />, gradient: "bg-gradient-to-br from-brand to-brand-dark", rotate: 8, style: { right: "2%", top: "4%" } },
  { label: "Diagnose", icon: <IconBrain />, gradient: "bg-gradient-to-br from-ink-800 to-ink", rotate: -5, style: { right: "15%", top: "20%" } },
  { label: "Execute", icon: <IconBolt />, gradient: "bg-gradient-to-br from-brand-dark to-ink", rotate: 7, style: { left: "2%", top: "66%" } },
  { label: "Audit", icon: <IconLedger />, gradient: "bg-gradient-to-br from-ink-900 to-ink-800", rotate: -6, style: { left: "15%", top: "80%" } },
  // Guardrail is the one chip that breaks the blue/ink pattern on
  // purpose — it's the one stage that can say no to everything else.
  { label: "Guardrail", icon: <IconShield />, gradient: "bg-gradient-to-br from-accent-dark to-accent", rotate: -7, style: { right: "2%", top: "66%" } },
  { label: "Measure", icon: <IconChart />, gradient: "bg-gradient-to-br from-ink-800 to-ink-900", rotate: 6, style: { right: "15%", top: "80%" } },
] as const;

export function Landing({ onOpenConsole, onHowItWorks }: { onOpenConsole: () => void; onHowItWorks: () => void }) {
  return (
    <div>
      {/* Hero */}
      <section className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-ink px-6 py-24 text-center sm:px-12">
        <div className="pointer-events-none absolute inset-0 bg-dot-grid bg-dot-grid opacity-[0.15]" />

        {/* Floating stage chips — decorative on md+, hidden on small screens where the scatter layout has no room. */}
        <div className="pointer-events-none absolute inset-0 hidden lg:block">
          {CHIPS.map((chip) => (
            <StageChip
              key={chip.label}
              label={chip.label}
              icon={chip.icon}
              gradient={chip.gradient}
              rotate={chip.rotate}
              style={chip.style}
            />
          ))}
        </div>

        <div className="relative mx-auto max-w-lg lg:max-w-xl">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">
            RazorSafe / Razorpay Buildathon / Track 03
          </div>
          <h1 className="mt-4 font-display text-5xl font-bold tracking-tight text-white sm:text-6xl">
            Recover<span className="text-brand">.</span>
            <br />
            Never unsupervised<span className="text-brand">.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-white/60">
            Every payment failure, checkout drop-off, and overdue invoice — detected, diagnosed, and recovered by AI.
            Bounded end to end by a guardrail engine that never lets a model touch money on its own say-so.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={onOpenConsole}
              className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink transition hover:bg-brand hover:text-white"
            >
              Open the console
            </button>
            <button
              onClick={onHowItWorks}
              className="flex items-center gap-1.5 rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-white transition hover:border-brand hover:text-brand"
            >
              See how it works <IconArrowUpRight />
            </button>
          </div>
        </div>
      </section>

      {/* Pipeline teaser */}
      <section className="mx-auto max-w-6xl px-6 py-16 sm:px-12">
        <PipelineTeaser />
      </section>

      {/* "It's real" section */}
      <section className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-6 py-10 sm:px-12 lg:grid-cols-2 lg:gap-16">
        <div className="rounded-2xl border border-ink/10 bg-white p-4 shadow-card">
          <PipelineDiagram compact />
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">Not a demo script</div>
          <h2 className="mt-3 font-display text-3xl font-bold text-ink sm:text-4xl">
            Every action here is real, not simulated.
          </h2>
          <p className="mt-4 text-slate-500">
            The reasoning model never gets a credential or an API client — it returns a structured proposal, and
            nothing. A deterministic guardrail engine, plain code with no model call inside it, is the only thing
            that can turn that proposal into a real payment retry or a real message. Fifteen named rules, each one
            unit-tested, each rejection logged with the rule that fired.
          </p>
          <button
            onClick={onHowItWorks}
            className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-brand px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark"
          >
            Walk through the pipeline <IconArrowUpRight />
          </button>
        </div>
      </section>

      {/* Stat tiles — true facts about the system itself, not merchant data,
          so they hold regardless of which tenant is being demoed. */}
      <section className="mx-auto max-w-6xl px-6 py-16 sm:px-12">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatBadge value="15" label="Guardrail rules" />
          <StatBadge value="99" label="Automated tests" />
          <StatBadge value="3" label="Recovery playbooks" />
          <StatBadge value="0" label="Unauthorized actions — by design" accent />
        </div>
      </section>

      {/* Dark CTA band */}
      <section className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-ink px-6 py-16 text-center sm:px-12">
        <div className="pointer-events-none absolute inset-0 bg-dot-grid opacity-[0.12]" />
        <div className="relative">
          <h2 className="font-display text-4xl font-bold text-white sm:text-5xl">
            See the <span className="text-brand">process</span>, not just the result.
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-white/60">
            Open a real case and read its Agent Timeline — every stage, every model call, every guardrail check, in
            order, with the raw input and output attached.
          </p>
          <button
            onClick={onOpenConsole}
            className="mt-8 rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink transition hover:bg-brand hover:text-white"
          >
            Open the console
          </button>
        </div>
      </section>
    </div>
  );
}

function StatBadge({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-6 text-center shadow-card">
      <div className={`font-display text-4xl font-bold ${accent ? "text-accent-dark" : "text-ink"}`}>{value}</div>
      <div className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}
