import { createHash } from "node:crypto";
import { and, count, eq, gt, gte, inArray, lt, ne } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "../db/client.js";
import { accounts, posts, type Account } from "../db/schema.js";
import type { Platform, PostKind } from "../types.js";

/**
 * Bewusst konservative Defaults – deutlich unter den API-Limits.
 * Reichweite entsteht durch Konsistenz und Qualität, nicht durch Volumen;
 * Volumen ist der schnellste Weg zu Shadowbans und gesperrten Accounts.
 */
export interface PlatformRules {
  maxChars: number;
  maxTitleChars?: number;
  needsSubreddit?: boolean;
  maxPostsPerDay: number;
  maxRepliesPerDay: number;
  minGapMinutes: number;
}

export const RULES: Record<Platform, PlatformRules> = {
  x: { maxChars: 280, maxPostsPerDay: 6, maxRepliesPerDay: 30, minGapMinutes: 90 },
  threads: { maxChars: 500, maxPostsPerDay: 5, maxRepliesPerDay: 30, minGapMinutes: 120 },
  linkedin: { maxChars: 3000, maxPostsPerDay: 1, maxRepliesPerDay: 20, minGapMinutes: 720 },
  reddit: { maxChars: 40000, maxTitleChars: 300, needsSubreddit: true, maxPostsPerDay: 1, maxRepliesPerDay: 15, minGapMinutes: 720 },
};

const ACTIVE = ["pending_approval", "scheduled", "publishing", "published"] as const;
const DUPLICATE_WINDOW_DAYS = 30;

export interface Draft {
  account: Account;
  kind: PostKind;
  text: string;
  title?: string | null;
  subreddit?: string | null;
  scheduledAt: Date;
}

export function contentHash(text: string, title?: string | null): string {
  const normalized = `${title ?? ""}\n${text}`.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex");
}

export function contentProblems(d: Draft): string[] {
  const r = RULES[d.account.platform];
  const problems: string[] = [];
  const len = [...d.text].length; // X zählt URLs/Emojis gewichtet – das hier ist eine Näherung
  if (!d.text.trim()) problems.push("Text ist leer.");
  if (len > r.maxChars) problems.push(`Text hat ${len} Zeichen, Limit für ${d.account.platform} ist ${r.maxChars}.`);
  if (d.kind === "post" && r.needsSubreddit) {
    if (!d.subreddit) problems.push("Reddit-Post braucht 'subreddit'.");
    if (!d.title) problems.push("Reddit-Post braucht 'title'.");
    if (d.title && r.maxTitleChars && d.title.length > r.maxTitleChars) problems.push(`Titel länger als ${r.maxTitleChars} Zeichen.`);
  }
  return problems;
}

export async function timingProblems(d: Pick<Draft, "account" | "kind" | "scheduledAt">, excludePostId?: string): Promise<string[]> {
  const r = RULES[d.account.platform];
  const problems: string[] = [];
  const base = and(
    eq(posts.accountId, d.account.id),
    eq(posts.kind, d.kind),
    inArray(posts.status, [...ACTIVE]),
    excludePostId ? ne(posts.id, excludePostId) : undefined,
  );

  const local = DateTime.fromJSDate(d.scheduledAt).setZone(d.account.timezone);
  const [day] = await db
    .select({ n: count() })
    .from(posts)
    .where(and(base, gte(posts.scheduledAt, local.startOf("day").toJSDate()), lt(posts.scheduledAt, local.endOf("day").toJSDate())));
  const cap = d.kind === "post" ? r.maxPostsPerDay : r.maxRepliesPerDay;
  if ((day?.n ?? 0) >= cap) problems.push(`Tageslimit erreicht (${cap} ${d.kind === "post" ? "Posts" : "Antworten"} am ${local.toISODate()}).`);

  if (d.kind === "post") {
    const gapMs = r.minGapMinutes * 60_000;
    const t = d.scheduledAt.getTime();
    const [near] = await db
      .select({ n: count() })
      .from(posts)
      .where(and(base, gt(posts.scheduledAt, new Date(t - gapMs)), lt(posts.scheduledAt, new Date(t + gapMs))));
    if ((near?.n ?? 0) > 0) problems.push(`Mindestabstand von ${r.minGapMinutes} min zu einem anderen Post unterschritten.`);
  }
  return problems;
}

export async function duplicateProblems(d: Draft, excludePostId?: string): Promise<string[]> {
  const hash = contentHash(d.text, d.title);
  const since = new Date(Date.now() - DUPLICATE_WINDOW_DAYS * 86_400_000);
  const excl = excludePostId ? ne(posts.id, excludePostId) : undefined;
  // Reddit: identischer Content über mehrere Subreddits/Accounts ist explizit untersagt
  const scope =
    d.account.platform === "reddit"
      ? inArray(posts.accountId, db.select({ id: accounts.id }).from(accounts).where(eq(accounts.platform, "reddit")))
      : eq(posts.accountId, d.account.id);
  const [dup] = await db
    .select({ n: count() })
    .from(posts)
    .where(and(scope, eq(posts.contentHash, hash), inArray(posts.status, [...ACTIVE]), gte(posts.createdAt, since), excl));
  return (dup?.n ?? 0) > 0 ? [`Gleicher Inhalt wurde in den letzten ${DUPLICATE_WINDOW_DAYS} Tagen schon geplant/gepostet.`] : [];
}

export async function validateDraft(d: Draft, excludePostId?: string): Promise<string[]> {
  return [...contentProblems(d), ...(await timingProblems(d, excludePostId)), ...(await duplicateProblems(d, excludePostId))];
}
