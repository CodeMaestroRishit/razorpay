import { env } from "../config/env.js";

/**
 * Sarvam's job per §8: STT (Saaras v3, codemix), TTS (Bulbul v3), native
 * -language generation, and text-lid — language-facing tasks only, never
 * reasoning. Root cause / recommendation stay on the reasoning LLM
 * (adapters/llm.ts); this adapter only renders an already-decided English
 * message in the customer's own language, or transcribes their reply.
 *
 * NOT Hinglish-only. Sarvam covers the major Indian languages — Hindi,
 * Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam, Punjabi,
 * Odia and others, plus code-mixed speech. `language` below is passed
 * through to Sarvam rather than being matched against a hardcoded list,
 * so a customer whose `language_pref` is 'ta' gets Tamil without any code
 * change here. Hinglish is one supported case, not the ceiling: a
 * merchant recovering revenue in Chennai and one in Kolkata should each
 * be dunned in the language their customer actually reads.
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
 * The `language` argument carries whatever `customers.language_pref`
 * holds — an ISO code ('hi', 'ta', 'bn', 'mr', …), 'hinglish', or any
 * other Sarvam-supported value. It is deliberately NOT validated against
 * a fixed list here: adding a language should be a data change, not a
 * code change.
 *
 * The only thing worth special-casing is English, because that is the
 * one value meaning "no localization needed" — the draft is already
 * English. Everything else goes to Sarvam. This set exists because the
 * value can also arrive as a model's free-text guess ("English" rather
 * than "en"), which previously slipped past an exact match and triggered
 * a pointless, failing translation of already-English text.
 */
const ENGLISH_ALIASES = new Set(["en", "eng", "english", "en-us", "en-in", "en-gb"]);
function isEnglish(language: string): boolean {
  return ENGLISH_ALIASES.has(language.trim().toLowerCase());
}

/**
 * Sarvam's translate endpoint takes region-suffixed codes (`ta-IN`, not
 * `ta`) — customers.language_pref stores bare codes, so this is where
 * that gap gets closed. 'hinglish' isn't a real target language, it's a
 * request for Hindi rendered in `code-mixed` mode (Sarvam's own name for
 * what most people mean by "Hinglish"); everything else maps straight
 * through as `${code}-IN` with `modern-colloquial` mode, which is what
 * keeps English loanwords (amount, subscription, retry) sitting naturally
 * inside the native-script sentence instead of forcing a stiff, fully
 * literary translation.
 */
function toSarvamTarget(language: string): { targetLanguageCode: string; mode: "code-mixed" | "modern-colloquial" } {
  if (language.trim().toLowerCase() === "hinglish") {
    return { targetLanguageCode: "hi-IN", mode: "code-mixed" };
  }
  return { targetLanguageCode: `${language.trim().toLowerCase()}-IN`, mode: "modern-colloquial" };
}

class LiveSarvamAdapter implements SarvamAdapter {
  private headers = { "api-subscription-key": env.sarvamApiKey!, "Content-Type": "application/json" };

  async generateLocalizedMessage(englishDraft: string, language: string, _tone?: string) {
    if (isEnglish(language)) return { text: englishDraft, degraded: false };
    const { targetLanguageCode, mode } = toSarvamTarget(language);
    const res = await fetch(`${SARVAM_BASE_URL}/translate`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        input: englishDraft,
        source_language_code: "en-IN",
        target_language_code: targetLanguageCode,
        model: "mayura:v1",
        mode,
      }),
    });
    if (!res.ok) return { text: englishDraft, degraded: true };
    const data = (await res.json()) as { translated_text?: string };
    return data.translated_text ? { text: data.translated_text, degraded: false } : { text: englishDraft, degraded: true };
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

export class MockSarvamAdapter implements SarvamAdapter {
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
