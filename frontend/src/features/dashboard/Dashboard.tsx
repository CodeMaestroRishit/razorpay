import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { api, formatInr } from "../../lib/api.js";
import { StatTile } from "../../components/ui/StatTile.js";

// Validated categorical pair from the dataviz reference palette (slots 1
// & 2) — adjacent-pair CVD Delta E 9.1 light / 8.4 dark, both clear the
// >=8 target, so this comparison is colorblind-safe as documented rather
// than eyeballed.
const COLOR_TREATED = "#2a78d6";
const COLOR_HOLDOUT = "#eb6834";

export function Dashboard({ merchantId }: { merchantId: string }) {
  const funnel = useQuery({ queryKey: ["funnel", merchantId], queryFn: () => api.funnel(merchantId) });
  const summary = useQuery({ queryKey: ["summary", merchantId], queryFn: () => api.summary(merchantId) });

  if (funnel.isLoading || summary.isLoading) {
    return <div className="p-8 text-slate-400">Loading dashboard…</div>;
  }
  if (funnel.isError || !funnel.data) {
    return <div className="p-8 text-[#d03b3b]">Failed to load funnel — is the backend running and seeded?</div>;
  }

  const f = funnel.data;
  const rateData = [
    { group: "Treated (agent-worked)", rate: Math.round(f.recoveryRateTreated * 1000) / 10, n: f.treatedCases },
    { group: "Holdout (no agent)", rate: Math.round(f.recoveryRateHoldout * 1000) / 10, n: f.holdoutCases },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-navy">Executive Dashboard</h1>
        <p className="mt-1 text-slate-500">
          Revenue recovery funnel, holdout-adjusted so the number is measured, not asserted (§11).
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Revenue at Risk" value={formatInr(f.revenueAtRisk)} sublabel="entered the outbox this campaign" />
        <StatTile
          label="Gross Recovered"
          value={formatInr(f.grossRecovered)}
          sublabel="includes cases that might have paid anyway"
          accent
        />
        <StatTile
          label="Incremental Recovered"
          value={formatInr(f.incrementalRecovered)}
          sublabel={
            f.holdoutSampleSufficient
              ? "gross minus the holdout baseline"
              : `indicative only — holdout n=${f.holdoutCases} is too small to be conclusive`
          }
          accent
        />
        <StatTile
          label="Active / Escalated"
          value={`${summary.data?.active_cases ?? 0} / ${summary.data?.escalated_cases ?? 0}`}
          sublabel={`of ${summary.data?.total_cases ?? 0} total cases`}
        />
      </div>

      <div className="rounded-2xl border border-navy/5 bg-white p-6 shadow-card">
        <h2 className="text-lg font-semibold text-navy">Recovery rate: treated vs holdout</h2>
        <p className="mt-1 text-sm text-slate-500">
          The gap between these two bars is the agent's actual, measured effect — everything else is uplift the
          business would have gotten anyway.
        </p>
        {!f.holdoutSampleSufficient && (
          <p className="mt-3 rounded-lg bg-[#FFF6E0] px-3 py-2 text-sm text-[#8a6300]">
            <strong>Read this as directional, not proven.</strong> The holdout arm has {f.holdoutCases} cases — at
            that size a single case changes the rate by several points, so the gap below is not yet statistically
            meaningful. It needs ~{20} holdout cases before the incremental figure is worth quoting.
          </p>
        )}
        <div className="mt-6 h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rateData} layout="vertical" margin={{ left: 24, right: 40 }} barCategoryGap="35%">
              <CartesianGrid horizontal={false} stroke="#e1e0d9" />
              <XAxis
                type="number"
                unit="%"
                domain={[0, (max: number) => Math.ceil((max * 1.2) / 5) * 5]}
                tick={{ fill: "#898781", fontSize: 12 }}
                axisLine={{ stroke: "#c3c2b7" }}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="group"
                width={190}
                tick={{ fill: "#0b0b0b", fontSize: 13 }}
                axisLine={false}
                tickLine={false}
                // The rate is meaningless without its denominator, so the
                // two travel together rather than the n living in a footnote.
                tickFormatter={(group: string) => {
                  const row = rateData.find((r) => r.group === group);
                  return row ? `${group}  n=${row.n}` : group;
                }}
              />
              <Tooltip
                cursor={{ fill: "rgba(10,37,64,0.04)" }}
                formatter={(value: number) => [`${value}%`, "Recovery rate"]}
                contentStyle={{ borderRadius: 12, border: "1px solid #e1e0d9", fontSize: 13 }}
              />
              <Bar dataKey="rate" radius={[0, 4, 4, 0]} maxBarSize={40} label={{ position: "right", formatter: (v: number) => `${v}%`, fill: "#52514e", fontSize: 12 }}>
                <Cell fill={COLOR_TREATED} />
                <Cell fill={COLOR_HOLDOUT} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
