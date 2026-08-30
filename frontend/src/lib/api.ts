const BASE = "/api";

export interface Funnel {
  revenueAtRisk: number;
  grossRecovered: number;
  incrementalRecovered: number;
  recoveryRateTreated: number;
  recoveryRateHoldout: number;
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
  funnel: (merchantId: string) => get<Funnel>("/dashboard/funnel", merchantId),
  summary: (merchantId: string) => get<Summary>("/dashboard/summary", merchantId),
  cases: (merchantId: string) => get<CaseRow[]>("/cases", merchantId),
  timeline: (merchantId: string, caseId: string) => get<TimelineEntry[]>(`/cases/${caseId}/timeline`, merchantId),
};

/** paise -> ₹, formatted. */
export function formatInr(paise: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
}
