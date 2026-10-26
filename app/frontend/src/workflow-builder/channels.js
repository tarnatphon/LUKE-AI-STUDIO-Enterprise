// Publishing channels — the browser side of the shared registry.
//
// The same file the local server uses to build a real API request
// (scripts/server/social-publish-channels.cjs) is bundled here for the UI, so a
// channel is described once: its authority, its link type, how hard signup is,
// how the one-click post is composed, and what the API request looks like.
// Vite converts the CommonJS module the same way it does for post-copy.js.

import registry from "../../../../scripts/server/social-publish-channels.cjs";

export const CHANNELS = registry.listChannels();
export const CHANNEL_GROUPS = registry.channelGroups();
export const CHANNELS_REVIEWED_AT = registry.NOTES_REVIEWED;

const BY_ID = new Map(CHANNELS.map((channel) => [channel.id, channel]));

export function channelById(id) {
  return BY_ID.get(String(id || "")) || null;
}

export function composeChannelPost(channelId, draft) {
  return registry.composePost(channelId, draft || {});
}

export const CHANNEL_LINK_TYPE_LABEL = {
  dofollow: "dofollow",
  nofollow: "nofollow",
  mixed: "ผสม",
  ugc: "UGC",
};

export const CHANNEL_AUTOMATION_LABEL = {
  api: "โพสต์อัตโนมัติได้",
  manual: "คลิกเดียว + วางข้อความ",
  import: "นำเข้า/วางข้อความ",
};

// A channel counts as automated only when the local server can really send it.
export const AUTOMATED_CHANNELS = CHANNELS.filter((channel) => channel.automation === "api");
