import { stdin, stdout } from "node:process";
import { createInterface, type Interface } from "node:readline";
import { and, asc, eq, like } from "drizzle-orm";
import { audit, db } from "../db/client.js";
import { accounts, inboxItems, posts, type Account, type InboxItem, type Post } from "../db/schema.js";
import { fmt } from "../scheduler/slots.js";
import { PLATFORMS, POST_KINDS, type Platform, type PostKind } from "../types.js";

/**
 * Menschliche Freigabe-Queue. Bewusst ausserhalb des MCP-Servers,
 * damit ein Agent seine eigenen Entwürfe nicht selbst freigeben kann.
 *
 *   npm run review                                  wartende Einträge anzeigen
 *   npm run review i                                interaktiv durchgehen (j/n/s/q)
 *   npm run review approve <id> [<id> …]            einzelne/mehrere freigeben (ID-Präfix reicht)
 *   npm run review approve --all [--platform=x] [--kind=reply]
 *                                                   Bulk: zeigt alle Treffer, dann Bestätigung
 *   npm run review reject …                         gleiche Varianten zum Verwerfen
 */
type Row = { p: Post; a: Account; i: InboxItem | null };
type Filter = { platform?: Platform; kind?: PostKind };

const [cmd = "list", ...rest] = process.argv.slice(2);
const flags = new Map<string, string | true>();
const ids: string[] = [];
for (const arg of rest) {
  if (arg.startsWith("--")) {
    const [key, value] = arg.slice(2).split("=");
    flags.set(key!, value ?? true);
  } else ids.push(arg);
}

// Zeilen-Queue statt rl.question(): funktioniert im Terminal und mit gepipetem Input
let rl: Interface | undefined;
const buffered: string[] = [];
let waiter: ((line: string) => void) | undefined;
let inputClosed = false;
function deliver(line: string) {
  if (waiter) {
    const w = waiter;
    waiter = undefined;
    w(line);
  } else buffered.push(line);
}
async function ask(question: string): Promise<string> {
  if (!rl) {
    rl = createInterface({ input: stdin, terminal: false });
    rl.on("line", deliver);
    rl.on("close", () => {
      inputClosed = true;
      deliver("q"); // Eingabe beendet (Ctrl+D) = abbrechen
    });
  }
  stdout.write(question);
  const line = buffered.shift() ?? (inputClosed ? "q" : await new Promise<string>((r) => (waiter = r)));
  return line.trim().toLowerCase();
}

function parseFilter(): Filter {
  const platform = flags.get("platform");
  const kind = flags.get("kind");
  if (platform !== undefined && !PLATFORMS.includes(platform as Platform)) throw new Error(`--platform: ${PLATFORMS.join(" | ")}`);
  if (kind !== undefined && !POST_KINDS.includes(kind as PostKind)) throw new Error(`--kind: ${POST_KINDS.join(" | ")}`);
  return { platform: platform as Platform | undefined, kind: kind as PostKind | undefined };
}

async function pending(filter: Filter = {}, idPrefix?: string): Promise<Row[]> {
  return db
    .select({ p: posts, a: accounts, i: inboxItems })
    .from(posts)
    .innerJoin(accounts, eq(posts.accountId, accounts.id))
    .leftJoin(inboxItems, eq(posts.inboxItemId, inboxItems.id))
    .where(
      and(
        eq(posts.status, "pending_approval"),
        filter.platform ? eq(accounts.platform, filter.platform) : undefined,
        filter.kind ? eq(posts.kind, filter.kind) : undefined,
        idPrefix ? like(posts.id, `${idPrefix}%`) : undefined,
      ),
    )
    .orderBy(asc(posts.scheduledAt));
}

function show({ p, a, i }: Row, pos?: string) {
  console.log("─".repeat(70));
  console.log(`${pos ? pos + "  " : ""}${p.id.slice(0, 8)}  [${a.platform}/@${a.handle}]  ${p.kind}  ${fmt(p.scheduledAt, a.timezone)}`);
  if (i) console.log(`  ↳ Antwort auf @${i.authorHandle}: "${i.text.slice(0, 200)}"`);
  if (p.title) console.log(`  Titel: ${p.title}  (r/${p.subreddit})`);
  console.log(`\n${p.text}\n`);
}

async function decide(row: Row, approve: boolean) {
  const { p } = row;
  if (approve) {
    const scheduledAt = p.kind === "reply" || p.scheduledAt.getTime() < Date.now() ? new Date() : p.scheduledAt;
    await db.update(posts).set({ status: "scheduled", scheduledAt }).where(and(eq(posts.id, p.id), eq(posts.status, "pending_approval")));
  } else {
    await db.update(posts).set({ status: "cancelled" }).where(and(eq(posts.id, p.id), eq(posts.status, "pending_approval")));
    if (p.inboxItemId) await db.update(inboxItems).set({ status: "new" }).where(eq(inboxItems.id, p.inboxItemId));
  }
  audit("cli", approve ? "approve" : "reject", { postId: p.id });
}

async function resolveIds(prefixes: string[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (const prefix of prefixes) {
    const hits = await pending({}, prefix);
    if (hits.length === 0) throw new Error(`Kein wartender Eintrag mit ID ${prefix}`);
    if (hits.length > 1) throw new Error(`ID ${prefix} ist mehrdeutig – mehr Zeichen angeben`);
    rows.push(hits[0]!);
  }
  return rows;
}

async function list() {
  const rows = await pending(parseFilter());
  if (!rows.length) return console.log("Nichts zur Freigabe. 🎉");
  rows.forEach((r) => show(r));
  console.log("─".repeat(70) + `\n${rows.length} Einträge · i | approve <id…> | approve --all | reject …`);
}

async function bulkOrIds(approve: boolean) {
  const verb = approve ? "freigeben" : "verwerfen";
  let rows: Row[];
  if (flags.has("all")) {
    rows = await pending(parseFilter());
    if (!rows.length) return console.log("Keine passenden Einträge.");
    rows.forEach((r) => show(r)); // Bulk heisst nicht blind: alles wird vorher angezeigt
    console.log("─".repeat(70));
    if ((await ask(`${rows.length} Einträge ${verb}? [j/N] `)) !== "j") return console.log("Abgebrochen.");
  } else {
    if (!ids.length) throw new Error(`IDs angeben oder --all verwenden`);
    rows = await resolveIds(ids);
  }
  for (const r of rows) await decide(r, approve);
  console.log(`${approve ? "✅" : "🗑️ "} ${rows.length} Einträge ${approve ? "freigegeben" : "verworfen"}.`);
}

async function interactive() {
  const rows = await pending(parseFilter());
  if (!rows.length) return console.log("Nichts zur Freigabe. 🎉");
  const tally = { approved: 0, rejected: 0, skipped: 0 };
  for (const [n, row] of rows.entries()) {
    show(row, `(${n + 1}/${rows.length})`);
    const a = await ask("[j] freigeben  [n] verwerfen  [s] überspringen  [q] beenden › ");
    if (a === "q") break;
    if (a === "j") { await decide(row, true); tally.approved++; }
    else if (a === "n") { await decide(row, false); tally.rejected++; }
    else tally.skipped++;
  }
  console.log(`\n✅ ${tally.approved} freigegeben · 🗑️  ${tally.rejected} verworfen · ⏭️  ${tally.skipped} übersprungen`);
}

try {
  if (cmd === "list") await list();
  else if (cmd === "i" || cmd === "interactive") await interactive();
  else if (cmd === "approve") await bulkOrIds(true);
  else if (cmd === "reject") await bulkOrIds(false);
  else console.log("Befehle: list | i | approve <id…> | approve --all [--platform=x] [--kind=reply] | reject …");
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  rl?.close();
}
