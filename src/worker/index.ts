import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { loadAccountCtx } from "../accounts.js";
import { env } from "../config.js";
import { connectors } from "../connectors/index.js";
import { HttpError } from "../connectors/http.js";
import { audit, db } from "../db/client.js";
import { accounts, inboxItems, posts, type Post } from "../db/schema.js";

const MAX_ATTEMPTS = 5;
const STALE_PUBLISHING_MS = 10 * 60_000;
const INBOX_LOOKBACK_DAYS = 7;
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

/**
 * Posts, die beim Absturz in "publishing" hängen geblieben sind, werden NICHT automatisch
 * erneut gesendet (Gefahr von Doppelposts), sondern als failed markiert → manuell prüfen.
 */
async function quarantineStale() {
  const cutoff = new Date(Date.now() - STALE_PUBLISHING_MS);
  const stale = await db
    .update(posts)
    .set({ status: "failed", lastError: "Unklarer Zustand nach Worker-Abbruch – auf der Plattform prüfen" })
    .where(and(eq(posts.status, "publishing"), lte(posts.scheduledAt, cutoff)))
    .returning({ id: posts.id });
  if (stale.length) log(`⚠️  ${stale.length} hängende Posts als failed markiert`);
}

async function claimDue(): Promise<Post[]> {
  const now = new Date();
  const due = await db
    .select()
    .from(posts)
    .where(and(eq(posts.status, "scheduled"), lte(posts.scheduledAt, now), or(isNull(posts.nextAttemptAt), lte(posts.nextAttemptAt, now))))
    .limit(10);
  const claimed: Post[] = [];
  for (const p of due) {
    // Atomarer Claim – falls je mehrere Worker laufen
    const r = db.update(posts).set({ status: "publishing" }).where(and(eq(posts.id, p.id), eq(posts.status, "scheduled"))).run();
    if (r.changes === 1) claimed.push(p);
  }
  return claimed;
}

async function publishOne(p: Post) {
  const account = await db.query.accounts.findFirst({ where: eq(accounts.id, p.accountId) });
  if (!account) return;
  const connector = connectors[account.platform];
  try {
    if (p.kind === "reply" && !connector.capabilities.reply) throw new Error(`${account.platform} unterstützt keine Antworten`);
    const ctx = await loadAccountCtx(account);
    const res = await connector.publish(ctx, { text: p.text, title: p.title, subreddit: p.subreddit, replyToExternalId: p.replyToExternalId });
    await db
      .update(posts)
      .set({ status: "published", publishedAt: new Date(), externalId: res.externalId, url: res.url ?? null, lastError: null })
      .where(eq(posts.id, p.id));
    if (p.inboxItemId) await db.update(inboxItems).set({ status: "answered" }).where(eq(inboxItems.id, p.inboxItemId));
    audit("worker", "published", { postId: p.id, platform: account.platform, url: res.url });
    log(`✅ ${account.platform}/@${account.handle} ${p.kind} veröffentlicht: ${res.url ?? res.externalId}`);
  } catch (err) {
    const attempts = p.attempts + 1;
    const retry = err instanceof HttpError && err.retryable && attempts < MAX_ATTEMPTS;
    const backoffSec = err instanceof HttpError && err.retryAfterSec ? err.retryAfterSec : 60 * 2 ** attempts;
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(posts)
      .set({
        status: retry ? "scheduled" : "failed",
        attempts,
        lastError: message.slice(0, 1000),
        nextAttemptAt: retry ? new Date(Date.now() + backoffSec * 1000) : null,
      })
      .where(eq(posts.id, p.id));
    audit("worker", retry ? "retry_scheduled" : "failed", { postId: p.id, error: message.slice(0, 300) });
    log(`${retry ? "🔁" : "❌"} ${account.platform} ${p.id}: ${message.slice(0, 200)}`);
  }
}

/** Holt Antworten auf eigene Posts der letzten Tage in die Inbox. */
async function pollInbox() {
  const since = new Date(Date.now() - INBOX_LOOKBACK_DAYS * 86_400_000);
  const rows = await db
    .select({ post: posts, account: accounts })
    .from(posts)
    .innerJoin(accounts, eq(posts.accountId, accounts.id))
    .where(and(eq(posts.status, "published"), eq(posts.kind, "post"), gte(posts.publishedAt, since)));

  for (const { post, account } of rows) {
    const connector = connectors[account.platform];
    if (!connector.fetchReplies || !connector.capabilities.readReplies || !post.externalId) continue;
    if (account.platform === "x" && !env.INBOX_POLL_X) continue;
    try {
      const ctx = await loadAccountCtx(account);
      const replies = await connector.fetchReplies(ctx, post.externalId);
      for (const r of replies) {
        await db
          .insert(inboxItems)
          .values({ accountId: account.id, platform: account.platform, externalId: r.externalId, parentExternalId: r.parentExternalId, authorHandle: r.authorHandle, text: r.text, receivedAt: r.createdAt })
          .onConflictDoNothing({ target: [inboxItems.platform, inboxItems.externalId] });
      }
    } catch (err) {
      log(`Inbox-Poll ${account.platform}/${post.id} fehlgeschlagen:`, err instanceof Error ? err.message : err);
    }
  }
}

let busy = false;
let lastInboxPoll = 0;

async function tick() {
  if (busy) return;
  busy = true;
  try {
    await quarantineStale();
    for (const p of await claimDue()) await publishOne(p); // sequenziell = schonend für Rate-Limits
    if (Date.now() - lastInboxPoll > env.INBOX_POLL_MINUTES * 60_000) {
      lastInboxPoll = Date.now();
      await pollInbox();
    }
  } catch (err) {
    log("Tick-Fehler:", err);
  } finally {
    busy = false;
  }
}

log(`Worker gestartet (Tick ${env.WORKER_TICK_SECONDS}s, Inbox alle ${env.INBOX_POLL_MINUTES} min)`);
void tick();
const timer = setInterval(tick, env.WORKER_TICK_SECONDS * 1000);
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    clearInterval(timer);
    log("Worker beendet");
    process.exit(0);
  });
}
