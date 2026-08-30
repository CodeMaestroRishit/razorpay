import { useState } from "react";
import { Dashboard } from "./features/dashboard/Dashboard.js";
import { CasesTable } from "./features/cases/CasesTable.js";
import { Timeline } from "./features/timeline/Timeline.js";

type Tab = "dashboard" | "cases";

const STORAGE_KEY = "revenue-recovery.merchant-id";

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [merchantId, setMerchantId] = useState(() => localStorage.getItem(STORAGE_KEY) ?? "");
  const [merchantInput, setMerchantInput] = useState(merchantId);
  const [selectedCase, setSelectedCase] = useState<string | null>(null);

  function applyMerchant() {
    setMerchantId(merchantInput.trim());
    localStorage.setItem(STORAGE_KEY, merchantInput.trim());
  }

  return (
    <div className="min-h-screen">
      <header className="bg-navy text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand font-black text-white">R</div>
            <div>
              <div className="text-sm font-semibold tracking-tight">AI Revenue Recovery</div>
              <div className="text-xs text-white/50">Razorpay Buildathon · Track 03</div>
            </div>
          </div>
          <nav className="flex items-center gap-1 rounded-full bg-white/10 p-1">
            {(["dashboard", "cases"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize transition ${
                  tab === t ? "bg-white text-navy" : "text-white/70 hover:text-white"
                }`}
              >
                {t}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {!merchantId ? (
          <div className="mx-auto mt-16 max-w-md rounded-2xl border border-navy/5 bg-white p-8 text-center shadow-card">
            <h2 className="text-lg font-bold text-navy">Enter a merchant ID</h2>
            <p className="mt-1 text-sm text-slate-500">
              Stands in for auth in this build. Run <code className="rounded bg-slate-100 px-1">npm run seed</code>{" "}
              in <code className="rounded bg-slate-100 px-1">backend/</code> — it prints one.
            </p>
            <div className="mt-4 flex gap-2">
              <input
                value={merchantInput}
                onChange={(e) => setMerchantInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyMerchant()}
                placeholder="merchant uuid"
                className="flex-1 rounded-lg border border-navy/10 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
              <button onClick={applyMerchant} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark">
                Go
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-6 flex justify-end">
              <button onClick={() => setMerchantId("")} className="text-xs text-slate-400 hover:text-brand-dark">
                switch merchant ({merchantId.slice(0, 8)}…)
              </button>
            </div>
            {tab === "dashboard" ? (
              <Dashboard merchantId={merchantId} />
            ) : (
              <CasesTable merchantId={merchantId} onSelect={setSelectedCase} />
            )}
          </>
        )}
      </main>

      {selectedCase && merchantId && (
        <Timeline merchantId={merchantId} caseId={selectedCase} onClose={() => setSelectedCase(null)} />
      )}
    </div>
  );
}
