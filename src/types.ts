export const PLATFORMS = ["x", "linkedin", "threads", "reddit"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const POST_KINDS = ["post", "reply"] as const;
export type PostKind = (typeof POST_KINDS)[number];

export const POST_STATUSES = [
  "pending_approval", // wartet auf menschliche Freigabe (npm run review)
  "scheduled",        // freigegeben, wird zum Zeitpunkt publiziert
  "publishing",       // vom Worker geclaimt
  "published",
  "failed",
  "cancelled",
] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const INBOX_STATUSES = ["new", "drafted", "answered", "dismissed"] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];
