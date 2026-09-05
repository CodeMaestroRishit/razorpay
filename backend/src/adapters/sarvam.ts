import { env } from "../config/env.js";

/**
 * Sarvam's job per §8: STT (Saaras v3, codemix), TTS (Bulbul v3), Hinglish
 * chat-completion generation, and text-lid — language-facing tasks only,
 * never reasoning. Root cause / recommendation stay on the reasoning LLM
 * (adapters/llm.ts); this adapter only translates an already-decided
 * English message into natural Hinglish/regional language, or transcribes
 * a customer's spoken reply.
 *
 * No SARVAM_API_KEY -> falls back to English templates, exactly as §8
 * and §4 specify for a Sarvam outage: "flag the case as degraded mode",
 * not fail silently.
 */
export interface SarvamAdapter {
  generateLocalizedMessage(englishDraft: string, language: string, tone?: string): Promise<{ text: string; degraded: boolean }>;
  transcribeCodemix(audioRef: string): Promise<{ codemix: string; english: string; degraded: boolean }>;
  detectLanguage(text: string): Promise<{ language: string; degraded: boolean }>;
}

const SARVAM_BASE_URL = "https://api.sarvam.ai";

/**
 * The `language` argument nominally carries an ISO-ish code (§8's
 * `language_pref` column stores "en"/"hi"/"hinglish"), but it can also
 * carry the reasoning LLM's free-text guess if a caller ever passes that
 * through unchecked. Defense in depth: recognize the common ways
 * "English" gets spelled before deciding whether translation is needed at
 * all, rather than only matching the exact string "en".
 */
const ENGLISH_ALIASES = new Set(["en", "eng", "english", "en-us", "en-in", "en-gb"]);
function isEnglish(language: string): boolean {
  return ENGLISH_ALIASES.has(language.trim().toLowerCase());
}

class LiveSarvamAdapter implements SarvamAdapter {
  private headers = { "api-subscription-key": env.sarvamApiKey!, "Content-Type": "application/json" };

  async generateLocalizedMessage(englishDraft: string, language: string, tone?: string) {
    if (isEnglish(language)) return { text: englishDraft, degraded: false };
    const res = await fetch(`${SARVAM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content: `Rewrite the following message naturally in ${language}, matching a ${tone ?? "polite"} tone. Keep it short, code-mixed where natural (Hinglish, not stiff literary translation).`,
          },
          { role: "user", content: englishDraft },
        ],
      }),
    });
    if (!res.ok) return { text: englishDraft, degraded: true };
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content;
    return text ? { text, degraded: false } : { text: englishDraft, degraded: true };
  }

  async transcribeCodemix(audioRef: string) {
    // Saaras v3, codemix mode — purpose-built for Hindi-English code-switching (§8).
    // Demo scope: batch/REST endpoint against a pre-recorded snippet, not a live call.
    const res = await fetch(`${SARVAM_BASE_URL}/speech-to-text`, {
      method: "POST",
      headers: { "api-subscription-key": env.sarvamApiKey! },
      body: (() => {
        const form = new FormData();
        form.append("model", "saaras:v3");
        form.append("mode", "codemix");
        form.append("audio_ref", audioRef);
        return form;
      })(),
    });
    if (!res.ok) return { codemix: "", english: "", degraded: true };
    const data = (await res.json()) as { transcript?: string; translated_transcript?: string };
    return {
      codemix: data.transcript ?? "",
      english: data.translated_transcript ?? data.transcript ?? "",
      degraded: !data.transcript,
    };
  }

  async detectLanguage(text: string) {
    const res = await fetch(`${SARVAM_BASE_URL}/text-lid`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ input: text }),
    });
    if (!res.ok) return { language: "en", degraded: true };
    const data = (await res.json()) as { language_code?: string };
    return { language: data.language_code ?? "en", degraded: !data.language_code };
  }
}

class MockSarvamAdapter implements SarvamAdapter {
  async generateLocalizedMessage(englishDraft: string, language: string) {
    if (isEnglish(language)) return { text: englishDraft, degraded: false };
    // Degraded mode: English template, flagged — not a silent failure (§4, §8).
    return { text: englishDraft, degraded: true };
  }

  async transcribeCodemix(_audioRef: string) {
    return { codemix: "", english: "", degraded: true };
  }

  async detectLanguage(_text: string) {
    return { language: "en", degraded: true };
  }
}

export function createSarvamAdapter(): SarvamAdapter {
  return env.sarvamApiKey ? new LiveSarvamAdapter() : new MockSarvamAdapter();
}
