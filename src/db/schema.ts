import { randomUUID } from "node:crypto";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { INBOX_STATUSES, PLATFORMS, POST_KINDS, POST_STATUSES } from "../types.js";

const id = () => text("id").primaryKey().$defaultFn(() => randomUUID());
const ts = (name: string) => integer(name, { mode: "timestamp" });
const createdAt = () => ts("created_at").notNull().$defaultFn(() => new Date());

/** Verbundene Social-Accounts (ein Eintrag pro Plattform-User). */
export const accounts = sqliteTable(
  "accounts",
  {
    id: id(),
    platform: text("platform", { enum: PLATFORMS }).notNull(),
    handle: text("handle").notNull(),
    externalUserId: text("external_user_id").notNull(),
    accessTokenEnc: text("access_token_enc").notNull(),
    refreshTokenEnc: text("refresh_token_enc"),
    tokenExpiresAt: ts("token_expires_at"),
    timezone: text("timezone").notNull().default("Europe/Zurich"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("accounts_platform_user").on(t.platform, t.externalUserId)],
);

/** Wiederkehrende Posting-Slots, z.B. Di 08:30 (weekday: 1 = Mo … 7 = So, Zeit in Account-Zeitzone). */
export const postingSlots = sqliteTable("posting_slots", {
  id: id(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  weekday: integer("weekday").notNull(),
  time: text("time").notNull(), // "HH:MM"
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
});

/** Eigene Posts UND Antworten – beides läuft durch dieselbe Queue. */
export const posts = sqliteTable(
  "posts",
  {
    id: id(),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: POST_KINDS }).notNull().default("post"),
    text: text("text").notNull(),
    title: text("title"), // Reddit
    subreddit: text("subreddit"), // Reddit
    replyToExternalId: text("reply_to_external_id"),
    inboxItemId: text("inbox_item_id"),
    status: text("status", { enum: POST_STATUSES }).notNull(),
    scheduledAt: ts("scheduled_at").notNull(),
    nextAttemptAt: ts("next_attempt_at"),
    attempts: integer("attempts").notNull().default(0),
    publishedAt: ts("published_at"),
    externalId: text("external_id"),
    url: text("url"),
    lastError: text("last_error"),
    contentHash: text("content_hash").notNull(),
    source: text("source").notNull().default("mcp"),
    createdAt: createdAt(),
  },
  (t) => [index("posts_due").on(t.status, t.scheduledAt), index("posts_hash").on(t.contentHash)],
);

/** Antworten anderer auf eigene Posts (Engagement-Inbox). */
export const inboxItems = sqliteTable(
  "inbox_items",
  {
    id: id(),
    accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: PLATFORMS }).notNull(),
    externalId: text("external_id").notNull(),
    parentExternalId: text("parent_external_id").notNull(),
    authorHandle: text("author_handle").notNull(),
    text: text("text").notNull(),
    receivedAt: ts("received_at").notNull(),
    status: text("status", { enum: INBOX_STATUSES }).notNull().default("new"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("inbox_platform_external").on(t.platform, t.externalId)],
);

/** Nachvollziehbarkeit: wer hat was wann ausgelöst (mcp / cli / worker / auth). */
export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  at: ts("at").notNull().$defaultFn(() => new Date()),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  detail: text("detail"),
});

export type Account = typeof accounts.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type InboxItem = typeof inboxItems.$inferSelect;
