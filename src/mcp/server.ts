import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getAccount } from "../accounts.js";
import { env } from "../config.js";
import { connectors } from "../connectors/index.js";
import { audit, db } from "../db/client.js";
import { accounts, inboxItems, postingSlots, posts } from "../db/schema.js";
import { contentHash, RULES, validateDraft } from "../scheduler/policy.js";
import { fmt, nextFreeSlot } from "../scheduler/slots.js";
import { INBOX_STATUSES, POST_STATUSES } from "../types.js";

// WICHTIG (stdio): nie auf stdout loggen – nur console.error.

const INSTRUCTIONS = `ReachPilot plant und publiziert Inhalte über offizielle APIs (X, LinkedIn, Threads, Reddit).
Ablauf: list_accounts → get/set_posting_slots → schedule_post. Antworten: list_inbox → draft_reply.
Regeln: Schreibe pro Plattform nativen Content (nicht 1:1 crossposten). Antworten werden NIE direkt publiziert,
sondern landen in der Freigabe-Queue; der Mensch gibt sie mit \`npm run review\` frei. Dieses Tool hat bewusst
keine Funktionen für Likes, Follows, Votes oder unaufgeforderte Kommentare unter fremden Posts.`;

const server = new McpServer({ name: "reachpilot", version: "0.1.0" }, { instructions: INSTRUCTIONS });

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });
const guard = <A>(fn: (a: A) => Promise<ReturnType<typeof ok>>) => async (a: A) => {
  try {
    return await fn(a);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
};
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format HH:MM");

server.registerTool(
  "list_accounts",
  { title: "Accounts auflisten", description: "Verbundene Social-Accounts mit Fähigkeiten und Limits.", inputSchema: {} },
  guard(async () => {
    const rows = await db.select().from(accounts).orderBy(asc(accounts.platform));
    return ok(
      rows.map((a) => ({
        id: a.id,
        platform: a.platform,
        handle: a.handle,
        timezone: a.timezone,
        capabilities: connectors[a.platform].capabilities,
        limits: RULES[a.platform],
        tokenExpires: fmt(a.tokenExpiresAt, a.timezone),
      })),
    );
  }),
);

server.registerTool(
  "get_posting_slots",
  { title: "Posting-Slots anzeigen", description: "Wiederkehrende Posting-Zeiten eines Accounts.", inputSchema: { accountId: z.string() } },
  guard(async ({ accountId }) => {
    const account = await getAccount(accountId);
    const slots = await db.select().from(postingSlots).where(eq(postingSlots.accountId, accountId));
    return ok({ timezone: account.timezone, slots: slots.map(({ weekday, time, enabled }) => ({ weekday, time, enabled })) });
  }),
);

server.registerTool(
  "set_posting_slots",
  {
    title: "Posting-Slots setzen",
    description: "Ersetzt alle Slots eines Accounts. weekday: 1=Mo … 7=So. Zeiten in der Account-Zeitzone.",
    inputSchema: {
      accountId: z.string(),
      timezone: z.string().optional().describe("IANA-Zeitzone, z.B. Europe/Zurich"),
      slots: z.array(z.object({ weekday: z.number().int().min(1).max(7), time })).max(50),
    },
  },
  guard(async ({ accountId, timezone, slots }) => {
    await getAccount(accountId);
    db.transaction((tx) => {
      if (timezone) tx.update(accounts).set({ timezone }).where(eq(accounts.id, accountId)).run();
      tx.delete(postingSlots).where(eq(postingSlots.accountId, accountId)).run();
      if (slots.length) tx.insert(postingSlots).values(slots.map((s) => ({ ...s, accountId }))).run();
    });
    audit("mcp", "set_posting_slots", { accountId, count: slots.length });
    return ok({ saved: slots.length });
  }),
);

server.registerTool(
  "schedule_post",
  {
    title: "Post planen",
    description:
      "Plant einen eigenen Post. Ohne 'at' wird der nächste freie Slot genommen. Prüft Zeichenlimit, Tageslimit, Mindestabstand und Duplikate.",
    inputSchema: {
      accountId: z.string(),
      text: z.string().min(1),
      title: z.string().optional().describe("Nur Reddit"),
      subreddit: z.string().optional().describe("Nur Reddit, ohne 'r/'"),
      at: z.string().datetime({ offset: true }).optional().describe("ISO-8601 mit Offset, z.B. 2026-11-12T08:30:00+01:00"),
    },
  },
  guard(async ({ accountId, text, title, subreddit, at }) => {
    const account = await getAccount(accountId);
    const scheduledAt = at ? new Date(at) : await nextFreeSlot(account);
    if (!scheduledAt) return fail("Kein freier Slot in den nächsten 4 Wochen – set_posting_slots aufrufen oder 'at' angeben.");
    if (scheduledAt.getTime() < Date.now() - 60_000) return fail("Zeitpunkt liegt in der Vergangenheit.");

    const problems = await validateDraft({ account, kind: "post", text, title, subreddit, scheduledAt });
    if (problems.length) return fail("Nicht geplant:\n- " + problems.join("\n- "));

    const status = env.APPROVAL_MODE === "all" ? "pending_approval" : "scheduled";
    const [row] = await db
      .insert(posts)
      .values({ accountId, kind: "post", text, title, subreddit: subreddit?.replace(/^r\//, ""), scheduledAt, status, contentHash: contentHash(text, title) })
      .returning();
    audit("mcp", "schedule_post", { postId: row!.id });
    return ok({ postId: row!.id, status, scheduledAt: fmt(scheduledAt, account.timezone) });
  }),
);

server.registerTool(
  "update_post",
  {
    title: "Geplanten Post ändern",
    description: "Ändert Text/Titel/Zeitpunkt eines noch nicht veröffentlichten Posts (validiert erneut).",
    inputSchema: {
      postId: z.string(),
      text: z.string().min(1).optional(),
      title: z.string().optional(),
      at: z.string().datetime({ offset: true }).optional(),
    },
  },
  guard(async ({ postId, text, title, at }) => {
    const post = await db.query.posts.findFirst({ where: eq(posts.id, postId) });
    if (!post) return fail("Post nicht gefunden.");
    if (!["pending_approval", "scheduled"].includes(post.status)) return fail(`Post ist bereits '${post.status}'.`);
    const account = await getAccount(post.accountId);
    const next = { text: text ?? post.text, title: title ?? post.title, scheduledAt: at ? new Date(at) : post.scheduledAt };
    const problems = await validateDraft({ account, kind: post.kind, subreddit: post.subreddit, ...next }, postId);
    if (problems.length) return fail("Nicht geändert:\n- " + problems.join("\n- "));
    await db.update(posts).set({ ...next, contentHash: contentHash(next.text, next.title) }).where(eq(posts.id, postId));
    audit("mcp", "update_post", { postId });
    return ok({ postId, scheduledAt: fmt(next.scheduledAt, account.timezone) });
  }),
);

server.registerTool(
  "cancel_post",
  { title: "Post stornieren", description: "Storniert einen geplanten oder wartenden Post/Entwurf.", inputSchema: { postId: z.string() } },
  guard(async ({ postId }) => {
    const r = await db
      .update(posts)
      .set({ status: "cancelled" })
      .where(and(eq(posts.id, postId), inArray(posts.status, ["pending_approval", "scheduled"])))
      .returning({ id: posts.id, inboxItemId: posts.inboxItemId });
    if (!r.length) return fail("Nichts storniert (nicht gefunden oder schon veröffentlicht).");
    if (r[0]!.inboxItemId) await db.update(inboxItems).set({ status: "new" }).where(eq(inboxItems.id, r[0]!.inboxItemId));
    audit("mcp", "cancel_post", { postId });
    return ok({ cancelled: postId });
  }),
);

server.registerTool(
  "list_posts",
  {
    title: "Posts auflisten",
    description: "Geplante, wartende oder veröffentlichte Posts/Antworten.",
    inputSchema: {
      accountId: z.string().optional(),
      status: z.enum(POST_STATUSES).optional(),
      limit: z.number().int().min(1).max(100).default(25),
    },
  },
  guard(async ({ accountId, status, limit }) => {
    const rows = await db
      .select({ p: posts, a: accounts })
      .from(posts)
      .innerJoin(accounts, eq(posts.accountId, accounts.id))
      .where(and(accountId ? eq(posts.accountId, accountId) : undefined, status ? eq(posts.status, status) : undefined))
      .orderBy(desc(posts.scheduledAt))
      .limit(limit);
    return ok(
      rows.map(({ p, a }) => ({
        id: p.id,
        account: `${a.platform}/@${a.handle}`,
        kind: p.kind,
        status: p.status,
        scheduledAt: fmt(p.scheduledAt, a.timezone),
        text: p.text.length > 160 ? p.text.slice(0, 160) + "…" : p.text,
        url: p.url,
        lastError: p.lastError,
      })),
    );
  }),
);

server.registerTool(
  "list_inbox",
  {
    title: "Engagement-Inbox",
    description: "Antworten anderer auf eigene Posts (wird vom Worker periodisch abgeholt).",
    inputSchema: {
      accountId: z.string().optional(),
      status: z.enum(INBOX_STATUSES).default("new"),
      limit: z.number().int().min(1).max(100).default(25),
    },
  },
  guard(async ({ accountId, status, limit }) => {
    const rows = await db
      .select()
      .from(inboxItems)
      .where(and(eq(inboxItems.status, status), accountId ? eq(inboxItems.accountId, accountId) : undefined))
      .orderBy(desc(inboxItems.receivedAt))
      .limit(limit);
    return ok(rows.map(({ id, platform, authorHandle, text, receivedAt, parentExternalId }) => ({ id, platform, authorHandle, text, receivedAt, parentExternalId })));
  }),
);

server.registerTool(
  "draft_reply",
  {
    title: "Antwort entwerfen",
    description:
      "Legt einen Antwort-Entwurf an. Er wird NICHT direkt publiziert, sondern wartet auf menschliche Freigabe (npm run review). Entweder inboxItemId ODER accountId + replyToExternalId angeben.",
    inputSchema: {
      text: z.string().min(1),
      inboxItemId: z.string().optional(),
      accountId: z.string().optional(),
      replyToExternalId: z.string().optional().describe("Externe ID des Posts/Kommentars, auf den geantwortet wird"),
    },
  },
  guard(async ({ text, inboxItemId, accountId, replyToExternalId }) => {
    const item = inboxItemId ? await db.query.inboxItems.findFirst({ where: eq(inboxItems.id, inboxItemId) }) : undefined;
    if (inboxItemId && !item) return fail("Inbox-Eintrag nicht gefunden.");
    const accId = item?.accountId ?? accountId;
    const target = item?.externalId ?? replyToExternalId;
    if (!accId || !target) return fail("inboxItemId oder (accountId + replyToExternalId) angeben.");

    const account = await getAccount(accId);
    if (!connectors[account.platform].capabilities.reply) return fail(`${account.platform}: Antworten über die API derzeit nicht verfügbar.`);
    const scheduledAt = new Date();
    const problems = await validateDraft({ account, kind: "reply", text, scheduledAt });
    if (problems.length) return fail("Nicht angelegt:\n- " + problems.join("\n- "));

    const [row] = await db
      .insert(posts)
      .values({ accountId: accId, kind: "reply", text, replyToExternalId: target, inboxItemId: item?.id, status: "pending_approval", scheduledAt, contentHash: contentHash(text) })
      .returning();
    if (item) await db.update(inboxItems).set({ status: "drafted" }).where(eq(inboxItems.id, item.id));
    audit("mcp", "draft_reply", { postId: row!.id });
    return ok({ postId: row!.id, status: "pending_approval", hint: "Freigabe mit: npm run review" });
  }),
);

server.registerTool(
  "dismiss_inbox_item",
  { title: "Inbox-Eintrag ignorieren", description: "Markiert eine Antwort als erledigt ohne zu antworten.", inputSchema: { inboxItemId: z.string() } },
  guard(async ({ inboxItemId }) => {
    await db.update(inboxItems).set({ status: "dismissed" }).where(eq(inboxItems.id, inboxItemId));
    return ok({ dismissed: inboxItemId });
  }),
);

await server.connect(new StdioServerTransport());
console.error("ReachPilot MCP-Server läuft (stdio)");
