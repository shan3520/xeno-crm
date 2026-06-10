import { createGoogleGenerativeAI } from "@ai-sdk/google";

/**
 * Gemini provider wiring. The app's ONLY runtime LLM is Gemini via @ai-sdk/google — model id
 * and key come from env (never hardcoded). GEMINI_MODEL is the main reasoning model;
 * GEMINI_MODEL_FAST is reserved for cheap classification.
 */

export const GEMINI_MODEL_ID = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
export const GEMINI_MODEL_FAST_ID =
  process.env.GEMINI_MODEL_FAST ?? "gemini-2.5-flash-lite";

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY ?? "",
});

/** The main reasoning model used by the chat route and the tool generators. */
export function geminiModel() {
  return google(GEMINI_MODEL_ID);
}

/** True when the server has a key configured — lets the route fail fast with a clear message. */
export function hasGeminiKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}
