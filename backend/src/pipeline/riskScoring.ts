import type { RevenueRiskEvent, RiskScore } from "../types/domain.js";

/**
 * Deterministic scoring function — plain code, not an LLM judgment call
 * (§9: "same inputs always produce the same segment"). Factors are
 * additive and capped to [0, 1] so the output is always explainable as
 * "these specific factors, these specific weights."
 */
export function scoreRisk(event: RevenueRiskEvent, context: { amount: number; failureCode?: string; retryCount?: number }): RiskScore {
  const factors: Record<string, number> = {};

  switch (event.type) {
    case "payment_failed": {
      factors.base_payment_failed = 0.4;
      if (context.failureCode === "insufficient_funds") factors.insufficient_funds = 0.2;
      if (context.failureCode === "card_expired") factors.card_expired = 0.1;
      if (context.failureCode === "bank_decline") factors.bank_decline = 0.25;
      if ((context.retryCount ?? 0) > 0) factors.prior_retries = 0.1 * Math.min(context.retryCount ?? 0, 3);
      break;
    }
    case "checkout_abandoned": {
      factors.base_abandoned = 0.3;
      if (context.amount > 500000) factors.high_value_cart = 0.2; // > ₹5,000
      break;
    }
    case "invoice_overdue": {
      factors.base_overdue = 0.5;
      if (context.amount > 10000000) factors.high_value_invoice = 0.2; // > ₹1,00,000
      break;
    }
    case "promise_to_pay_broken": {
      factors.broken_promise = 0.6;
      break;
    }
    case "customer_responded": {
      factors.base_response = 0.1;
      break;
    }
  }

  const score = Math.min(
    1,
    Object.values(factors).reduce((sum, w) => sum + w, 0)
  );

  return { score, factors };
}
