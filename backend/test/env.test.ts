import { describe, it, expect } from "vitest";
import { withDefault } from "../src/config/env.js";

/**
 * Tests the resolution rule directly rather than importing the assembled
 * `env` object. Reading the ambient environment would make these depend on
 * whatever happens to be in the developer's .env file — which dotenv
 * reloads on every import, so an "unset" case can't even be simulated.
 */
describe("withDefault: blank env vars fall back, they don't pass through", () => {
  it("uses the default when the var is entirely absent", () => {
    expect(withDefault("ANY_KEY", "fallback", {})).toBe("fallback");
  });

  it("uses the default when the var is present but empty — the bug this regresses", () => {
    // Reproduces `OPENAI_MODEL=` left in a .env file: the key EXISTS with
    // value "". `"" ?? fallback` does not fall back (nullish coalescing
    // only triggers on null/undefined), so the empty string reached the
    // OpenAI client and every reasoning call failed with "400 you must
    // provide a model parameter" — silently absorbed by the pipeline's
    // own AI-outage fallback, so nothing surfaced except a degraded
    // root cause in the audit trail.
    expect(withDefault("ANY_KEY", "fallback", { ANY_KEY: "" })).toBe("fallback");
  });

  it("treats a whitespace-only value as a real value, not a blank", () => {
    // Deliberate: trimming here would silently rewrite a legitimate (if
    // odd) configured value. Only truly empty falls back.
    expect(withDefault("ANY_KEY", "fallback", { ANY_KEY: " " })).toBe(" ");
  });

  it("respects a real override", () => {
    expect(withDefault("ANY_KEY", "fallback", { ANY_KEY: "gpt-4o" })).toBe("gpt-4o");
  });
});
