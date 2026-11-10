import { count, eq } from "drizzle-orm";
import { connectors } from "../connectors/index.js";
import { db } from "../db/client.js";
import { accounts, inboxItems, posts } from "../db/schema.js";
import { POST_STATUSES } from "../types.js";
import { fmt } from "../scheduler/slots.js";

/** Kurzer Überblick: verbundene Accounts, Queue, letzte Fehler. `reachpilot status` */
const accs = await db.select().from(accounts);
console.log(`Accounts (${accs.length}):`);
for (const a of accs) {
  const c = connectors[a.platform].capabilities;
  const exp = a.tokenExpiresAt ? `Token bis ${fmt(a.tokenExpiresAt, a.timezone)}` : "Token ohne Ablauf";
  console.log(`  ${a.platform.padEnd(9)} @${a.handle}  [posten ${c.publish ? "✓" : "–"} · antworten ${c.reply ? "✓" : "–"} · inbox ${c.readReplies ? "✓" : "–"}]  ${exp}`);
}

const byStatus = await db.select({ status: posts.status, n: count() }).from(posts).groupBy(posts.status);
const m = new Map(byStatus.map((r) => [r.status, r.n]));
console.log("\nQueue: " + POST_STATUSES.map((s) => `${s} ${m.get(s) ?? 0}`).join(" · "));

const [inbox] = await db.select({ n: count() }).from(inboxItems).where(eq(inboxItems.status, "new"));
console.log(`Inbox neu: ${inbox?.n ?? 0}`);

const failed = await db.select().from(posts).where(eq(posts.status, "failed")).limit(5);
if (failed.length) {
  console.log("\nLetzte Fehler:");
  for (const p of failed) console.log(`  ${p.id.slice(0, 8)}  ${p.lastError?.slice(0, 120)}`);
}
