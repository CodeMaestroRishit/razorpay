export function StatTile({
  label,
  value,
  sublabel,
  accent = false,
}: {
  label: string;
  value: string;
  sublabel?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-6 shadow-card">
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className={`tabular mt-2 font-display text-3xl font-bold ${accent ? "text-brand" : "text-ink"}`}>{value}</div>
      {sublabel && <div className="mt-1 text-xs text-slate-400">{sublabel}</div>}
    </div>
  );
}
