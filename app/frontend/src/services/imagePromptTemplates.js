/**
 * The two system prompts the Enhance button sends.
 *
 * They live here, not in services/api.js, because they are ~3 kB of prose that
 * exactly one workspace sends — and api.js is in the entry bundle, so keeping
 * them there put a Generator-only string on every start-up. The budget test
 * (test-frontend-bundle-budgets.cjs) is what caught it.
 */

// The enhancement prompt is a quality lever, not decoration.
//
// Two things were wrong with the old one ("rewrite to be more descriptive and
// detailed ... under 60 words"). It asked for *more words*, which pushes past
// the 77-token CLIP chunk where the tail stops being attended (see
// promptBudget() in image-quality.cjs) — so it made prompts longer and adherence
// worse at the same time. And "more descriptive" invites adjectives ("stunning",
// "breathtaking", "8k") that diffusion models ignore or that actively flatten
// contrast, instead of the three things they do follow:
//
//   subject  — who/what, doing what, where
//   camera   — shot size, angle, lens; this is what separates a photo from mush
//   light    — the source and quality, the single strongest lever on "good"
//
// The rule is one clause per fact, no filler adjectives, and an explicit cap, so
// the rewrite lands inside one chunk instead of across two.
export const ENGLISH_IMAGE_PROMPT_SYSTEM = [
  "You rewrite image prompts for a local Stable Diffusion model.",
  "",
  "Rules:",
  "- Output one paragraph of at most 55 words. Longer prompts are split by the model and their ends are barely attended.",
  "- Say what the subject is and what it is doing, then where it is.",
  "- Name the camera: shot size (close-up, wide), angle, and lens if it helps.",
  "- Name the light: its source and quality (soft window light, hard noon sun, neon at night).",
  "- Concrete nouns beat adjectives. Delete 'beautiful', 'stunning', 'breathtaking', 'masterpiece', '8k', 'ultra detailed' — they do nothing here.",
  "- Keep every fact the user gave, including the language-specific details (signage, clothing, food). Do not invent a new subject.",
  "- Never mention settings, aspect ratio, resolution, quality, or that you are rewriting.",
  "",
  "Output ONLY the prompt. No preamble, no quotes, no explanation.",
].join("\n");

// The Thai bridge is a translation prompt first: Thai script is not in CLIP's
// vocabulary at all, so the model sees mojibake. Everything still has to be
// translated before the same rules can apply.
export const THAI_IMAGE_PROMPT_SYSTEM = [
  "You translate Thai image prompts into English for a Stable Diffusion model.",
  "",
  "Thai script is not in the model's vocabulary, so translation is mandatory — but translate faithfully and completely.",
  "- Output one paragraph of at most 55 words, in English only.",
  "- Preserve every specific detail: names, places, clothing, food, signage, colours.",
  "- After translating, apply these rules: say what the subject is doing and where; name the camera (shot size, angle); name the light (source and quality).",
  "- Concrete nouns beat adjectives. Never add 'beautiful', 'stunning', 'masterpiece', '8k', 'ultra detailed'.",
  "- Never mention settings, resolution, quality, or that this is a translation.",
  "",
  "Output ONLY the English prompt. No preamble, no quotes, no explanation.",
].join("\n");

/**
 * Trim a rewrite back to the model's attention budget, on a clause boundary.
 *
 * The templates ask for 55 words, but a local text model does not always obey a
 * word count — and an Enhance button that quietly hands the diffusion model a
 * 90-word prompt has made the picture worse while looking helpful. Cutting at
 * a comma keeps whole clauses (and so whole facts) instead of truncating
 * mid-phrase.
 *
 * Returns the text unchanged when it already fits.
 */
export function fitToPromptBudget(text, maxWords = 59) {
  const source = String(text || "").trim();
  if (!source) return source;
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return source;

  // Prefer a clause boundary in the second half of the budget; fall back to the
  // last comma, then to a hard cut.
  const kept = words.slice(0, maxWords).join(" ");
  const lastComma = Math.max(kept.lastIndexOf(","), kept.lastIndexOf(";"));
  const cut = lastComma > kept.length * 0.5 ? kept.slice(0, lastComma) : kept;
  return cut.replace(/[\s,;]+$/, "").trim();
}
