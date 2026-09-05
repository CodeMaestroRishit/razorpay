import { describe, it, expect } from "vitest";
import { MockSarvamAdapter } from "../src/adapters/sarvam.js";

/**
 * Constructed directly rather than via createSarvamAdapter(), which picks
 * Live vs Mock off `env.sarvamApiKey` — a real key in a developer's local
 * .env would otherwise make this "unit" test silently fire real, billed
 * network calls, exactly the ambient-environment coupling that bit
 * env.test.ts previously. This suite is about the English-detection
 * branch, not about the live adapter, so it names the mock explicitly.
 */
const adapter = new MockSarvamAdapter();

describe("sarvam adapter — English-detection is not just an exact 'en' match", () => {
  it("does not flag English content as degraded for the ISO code", async () => {
    const result = await adapter.generateLocalizedMessage("Hello", "en");
    expect(result.degraded).toBe(false);
    expect(result.text).toBe("Hello");
  });

  // This is the exact bug found live: the reasoning model returned the
  // free-text "English" instead of "en", which the old exact-match check
  // treated as a foreign language and tried (and failed) to translate.
  it("recognizes common spellings of English rather than only the exact code 'en'", async () => {
    for (const language of ["English", "ENGLISH", "eng", "en-US", "  en  "]) {
      const result = await adapter.generateLocalizedMessage("Hello", language);
      expect(result.degraded).toBe(false);
      expect(result.text).toBe("Hello");
    }
  });

  it("still treats a genuinely non-English language as needing localization", async () => {
    const result = await adapter.generateLocalizedMessage("Hello", "hi");
    // Mock adapter has no real Sarvam call to make, so it degrades —
    // the point here is that it takes the "not English" branch at all.
    expect(result.degraded).toBe(true);
  });
});
