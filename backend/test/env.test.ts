import { describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * env.ts reads process.env at import time, so each case needs a fresh
 * module instance — a cache-busting query string on the import, rather
 * than importing env once at the top of the file. Routed through a
 * variable (not a literal template) so TypeScript treats the specifier as
 * an opaque string instead of trying to statically resolve
 * "env.js?unset" as a real module path.
 */
function importFreshEnv(cacheBuster: string) {
  const path = `../src/config/env.js?${cacheBuster}`;
  return import(path) as Promise<typeof import("../src/config/env.js")>;
}

describe("env: blank env vars fall back to defaults, not empty strings", () => {
  const KEY = "OPENAI_MODEL";
  let original: string | undefined;

  beforeEach(() => {
    original = process.env[KEY];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it("uses the default when the var is entirely unset", async () => {
    delete process.env[KEY];
    const { env } = await importFreshEnv("unset");
    expect(env.openaiModel).toBe("gpt-5.5");
  });

  it("uses the default when the var is present but blank — the exact bug this regresses", async () => {
    // Reproduces `OPENAI_MODEL=` left in a .env file: process.env.OPENAI_MODEL
    // is "" here, not undefined. `""  ?? fallback` would NOT fall back
    // (nullish coalescing only triggers on null/undefined), so the empty
    // string would reach the OpenAI client and fail with "you must
    // provide a model parameter" — which is exactly what happened.
    process.env[KEY] = "";
    const { env } = await importFreshEnv("blank");
    expect(env.openaiModel).toBe("gpt-5.5");
  });

  it("respects a real override", async () => {
    process.env[KEY] = "gpt-4o";
    const { env } = await importFreshEnv("override");
    expect(env.openaiModel).toBe("gpt-4o");
  });
});
