import { describe, it, expect } from "vitest";
import { createSarvamAdapter } from "../src/adapters/sarvam.js";

/** No SARVAM_API_KEY in the vitest env, so this exercises the mock adapter. */
const adapter = createSarvamAdapter();

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
