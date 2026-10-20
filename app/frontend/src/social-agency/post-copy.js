// Per-client contact footer + the caption a platform actually receives.
// Kept out of lib.js so the calendar (and its server-render check) never pull in
// the shared CommonJS helper; only the copy/preview components import this file.
import postCopy from "../../../../scripts/server/social-agency-post-copy.cjs";

export const { captionFootersFor, footerLimit, formatPostCaption, THAI_MODERN_BAGS_CONTACT } = postCopy;

// Published text is historical truth. Never append today's contact settings to
// an old published caption; drafts and explicit platform previews are composed.
export function captionForPost(entry, client, { platform = entry?.platform || "demo", caption } = {}) {
  if (caption === undefined && entry?.publishedCaption) return String(entry.publishedCaption);
  return formatPostCaption(client, platform, caption === undefined ? entry?.caption : caption);
}


