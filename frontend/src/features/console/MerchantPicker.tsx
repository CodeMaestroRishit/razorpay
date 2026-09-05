import { useQuery } from "@tanstack/react-query";
import { api, BASE, type Merchant } from "../../lib/api.js";

/**
 * Replaces the old "paste a merchant UUID" form.
 *
 * That form was a real demo hazard: landing on the console and being
 * asked for an identifier you don't have, with no way to discover one
 * from the UI, is a dead end for anyone who didn't run the seed script
 * themselves. This lists the merchants that actually have cases and lets
 * you click one.
 */
export function MerchantPicker({ onSelect }: { onSelect: (merchantId: string) => void }) {
  const merchants = useQuery({ queryKey: ["merchants"], queryFn: api.merchants });

  return (
    <div className="mx-auto mt-12 max-w-xl">
      <div className="rounded-2xl border border-ink/10 bg-white p-8 shadow-card">
        <h2 className="font-display text-xl font-bold text-ink">Choose a merchant</h2>
        <p className="mt-1 text-sm text-slate-500">
          Stands in for authentication in this build — a real deployment would resolve the tenant from the signed-in
          session. Pick one to load its live cases.
        </p>

        {merchants.isLoading && <div className="mt-6 text-sm text-slate-400">Loading merchants…</div>}

        {merchants.isError && (
          <div className="mt-6 rounded-lg bg-[#FBEAEA] px-4 py-3 text-sm text-[#d03b3b]">
            <div>Couldn't reach the backend at <code className="rounded bg-white/60 px-1 font-mono">{BASE}/merchants</code>.</div>
            <div className="mt-1 text-xs text-[#d03b3b]/80">
              {merchants.error instanceof Error ? merchants.error.message : "Unknown error"}
            </div>
            <div className="mt-2 text-xs text-[#d03b3b]/80">
              {BASE.startsWith("/")
                ? "This is a relative path — it only works if Vite's dev proxy or your host forwards /api to the backend. If you're on localhost, make sure the backend is running (npm run dev in backend/) on port 4000."
                : "This is deployed to a fixed origin — check that the backend is actually up there, and that its CORS_ORIGINS setting includes this site's URL."}
            </div>
          </div>
        )}

        {merchants.data?.length === 0 && (
          <div className="mt-6 rounded-lg bg-accent-50 px-4 py-3 text-sm text-accent-dark">
            No merchants have cases yet. Run <code className="rounded bg-white px-1">npm run seed</code> in{" "}
            <code className="rounded bg-white px-1">backend/</code> to create some.
          </div>
        )}

        {merchants.data && merchants.data.length > 0 && (
          <ul className="mt-6 space-y-2">
            {merchants.data.map((m) => (
              <MerchantRow key={m.id} merchant={m} onSelect={onSelect} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MerchantRow({ merchant, onSelect }: { merchant: Merchant; onSelect: (id: string) => void }) {
  return (
    <li>
      <button
        onClick={() => onSelect(merchant.id)}
        className="flex w-full items-center justify-between rounded-xl border border-ink/10 px-4 py-3 text-left transition hover:border-brand hover:bg-brand-50"
      >
        <div>
          <div className="font-medium text-ink">{merchant.name}</div>
          <div className="font-mono text-xs text-slate-400">{merchant.id.slice(0, 8)}…</div>
        </div>
        <div className="text-right">
          <div className="tabular text-sm font-semibold text-brand">{merchant.case_count} cases</div>
          {merchant.latest_activity && (
            <div className="text-xs text-slate-400">
              {new Date(merchant.latest_activity).toLocaleDateString()}
            </div>
          )}
        </div>
      </button>
    </li>
  );
}
