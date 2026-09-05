import { useState } from "react";
import { Dashboard } from "./features/dashboard/Dashboard.js";
import { CasesTable } from "./features/cases/CasesTable.js";
import { Timeline } from "./features/timeline/Timeline.js";
import { Landing } from "./features/landing/Landing.js";
import { HowItWorks } from "./features/landing/HowItWorks.js";
import { MerchantPicker } from "./features/console/MerchantPicker.js";

type View = "landing" | "how" | "dashboard" | "cases";

const STORAGE_KEY = "revenue-recovery.merchant-id";

export default function App() {
  const [view, setView] = useState<View>("landing");
  const [merchantId, setMerchantId] = useState(() => localStorage.getItem(STORAGE_KEY) ?? "");
  const [selectedCase, setSelectedCase] = useState<string | null>(null);

  function applyMerchant(id: string) {
    setMerchantId(id);
    localStorage.setItem(STORAGE_KEY, id);
  }

  function clearMerchant() {
    setMerchantId("");
    localStorage.removeItem(STORAGE_KEY);
  }

  const inConsole = view === "dashboard" || view === "cases";

  return (
    <div className="min-h-screen bg-[#FAF8F5]">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <button onClick={() => setView("landing")} className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand font-display font-bold text-white">
              R
            </div>
            <div className="text-left">
              <div className="text-sm font-semibold tracking-tight text-ink">RazorSafe</div>
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
              <MerchantPicker onSelect={applyMerchant} />
            ) : (
              <>
                <div className="mb-6 flex justify-end">
                  <button onClick={clearMerchant} className="text-xs text-slate-400 hover:text-brand">
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
