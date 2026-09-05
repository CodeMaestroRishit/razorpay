import { useState } from "react";
import { Dashboard } from "./features/dashboard/Dashboard.js";
import { CasesTable } from "./features/cases/CasesTable.js";
import { Timeline } from "./features/timeline/Timeline.js";
import { Landing } from "./features/landing/Landing.js";
import { HowItWorks } from "./features/landing/HowItWorks.js";

type View = "landing" | "how" | "dashboard" | "cases";

const STORAGE_KEY = "revenue-recovery.merchant-id";

export default function App() {
  const [view, setView] = useState<View>("landing");
  const [merchantId, setMerchantId] = useState(() => localStorage.getItem(STORAGE_KEY) ?? "");
  const [merchantInput, setMerchantInput] = useState(merchantId);
  const [selectedCase, setSelectedCase] = useState<string | null>(null);

  function applyMerchant() {
    setMerchantId(merchantInput.trim());
    localStorage.setItem(STORAGE_KEY, merchantInput.trim());
  }

  const inConsole = view === "dashboard" || view === "cases";

  return (
    <div className="min-h-screen bg-[#FAF8F5]">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <button onClick={() => setView("landing")} className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink font-display font-bold text-gold">
              R
            </div>
            <div className="text-left">
              <div className="text-sm font-semibold tracking-tight text-ink">AI Revenue Recovery</div>
              <div className="text-[11px] text-slate-400">Razorpay Buildathon · Track 03</div>
            </div>
          </button>
          <nav className="flex items-center gap-1 rounded-full bg-ink/5 p-1">
            {(
              [
                ["landing", "Home"],
                ["how", "How it works"],
                ["dashboard", "Dashboard"],
                ["cases", "Cases"],
              ] as [View, string][]
            ).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                  view === v ? "bg-ink text-white" : "text-slate-500 hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main>
        {view === "landing" && <Landing onOpenConsole={() => setView("dashboard")} onHowItWorks={() => setView("how")} />}
        {view === "how" && <HowItWorks />}

        {inConsole && (
          <div className="mx-auto max-w-6xl px-6 py-10">
            {!merchantId ? (
              <div className="mx-auto mt-16 max-w-md rounded-2xl border border-ink/10 bg-white p-8 text-center shadow-card">
                <h2 className="text-lg font-bold text-ink">Enter a merchant ID</h2>
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
                    className="flex-1 rounded-lg border border-ink/10 px-3 py-2 text-sm focus:border-gold focus:outline-none"
                  />
                  <button onClick={applyMerchant} className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink-800">
                    Go
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="mb-6 flex justify-end">
                  <button onClick={() => setMerchantId("")} className="text-xs text-slate-400 hover:text-gold-dark">
                    switch merchant ({merchantId.slice(0, 8)}…)
                  </button>
                </div>
                {view === "dashboard" ? (
                  <Dashboard merchantId={merchantId} />
                ) : (
                  <CasesTable merchantId={merchantId} onSelect={setSelectedCase} />
                )}
              </>
            )}
          </div>
        )}
      </main>

      {selectedCase && merchantId && (
        <Timeline merchantId={merchantId} caseId={selectedCase} onClose={() => setSelectedCase(null)} />
      )}
    </div>
  );
}
