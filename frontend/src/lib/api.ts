/**
 * In dev this stays "/api" and Vite's proxy forwards to localhost:4000.
 * For a deployed frontend (Vercel) talking to a separately-hosted backend
 * (Railway/Render), set VITE_API_BASE_URL to that backend's origin at
 * build time — e.g. https://your-backend.up.railway.app/api
 */
export const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

export interface Merchant {
  id: string;
  name: string;
  case_count: number;
  latest_activity: string | null;
}

export interface Funnel {
  revenueAtRisk: number;
  grossRecovered: number;
  incrementalRecovered: number;
  recoveryRateTreated: number;
  recoveryRateHoldout: number;
  treatedCases: number;
  holdoutCases: number;
  holdoutSampleSufficient: boolean;
}

export interface Summary {
  active_cases: string;
  escalated_cases: string;
  total_cases: string;
}

export interface CaseRow {
  id: string;
  playbook: string;
  state: string;
  holdout: boolean;
  opened_at: string;
  closed_at: string | null;
  customer_name: string;
  phone: string | null;
  email: string | null;
  amount: string;
  risk_score: string | null;
  root_cause: string | null;
}

export interface TimelineEntry {
  stage: string;
  input: unknown;
  output: unknown;
  model: string | null;
  latency_ms: number | null;
  created_at: string;
}

async function get<T>(path: string, merchantId: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { "x-merchant-id": merchantId } });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export const api = {
  merchants: async (): Promise<Merchant[]> => {
    // No merchant header — this is the endpoint you call BEFORE you have one.
    const res = await fetch(`${BASE}/merchants`);
    if (!res.ok) throw new Error(`/merchants failed: ${res.status}`);
    return res.json();
  },
  funnel: (merchantId: string) => get<Funnel>("/dashboard/funnel", merchantId),
  summary: (merchantId: string) => get<Summary>("/dashboard/summary", merchantId),
  cases: (merchantId: string) => get<CaseRow[]>("/cases", merchantId),
  timeline: (merchantId: string, caseId: string) => get<TimelineEntry[]>(`/cases/${caseId}/timeline`, merchantId),
};

/** paise -> ₹, formatted. */
export function formatInr(paise: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
}
