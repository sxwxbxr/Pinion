import assert from "node:assert/strict";
import { test } from "node:test";
import { DateTime } from "luxon";
import { makeAccount } from "./helpers.js";
import { db } from "../src/db/client.js";
import { postingSlots } from "../src/db/schema.js";
import { nextFreeSlot } from "../src/scheduler/slots.js";

test("Nächster freier Slot liegt in der Zukunft und auf dem Slot-Wochentag", async () => {
  const account = await makeAccount("bluesky");
  await db.insert(postingSlots).values({ accountId: account.id, weekday: 2, time: "08:30" }); // Dienstag
  const after = DateTime.fromISO("2026-11-10T09:00", { zone: "Europe/Zurich" }).toJSDate(); // Di nach dem Slot
  const slot = await nextFreeSlot(account, after);
  assert.ok(slot);
  const local = DateTime.fromJSDate(slot).setZone("Europe/Zurich");
  assert.equal(local.toISODate(), "2026-11-17");
  assert.equal(local.toFormat("HH:mm"), "08:30");
});

test("Ohne Slots gibt es keinen Vorschlag", async () => {
  const account = await makeAccount("linkedin");
  assert.equal(await nextFreeSlot(account), null);
});

test("Bulk-Freigabe überfälliger Posts hält Mindestabstand ein statt alles sofort zu senden", async () => {
  const { approvalTime } = await import("../src/scheduler/slots.js");
  const { posts } = await import("../src/db/schema.js");
  const { contentHash } = await import("../src/scheduler/policy.js");
  const account = await makeAccount("bluesky");
  await db.insert(postingSlots).values([1, 2, 3, 4, 5, 6, 7].flatMap((weekday) => ["09:00", "15:00"].map((time) => ({ accountId: account.id, weekday, time }))));
  const now = new Date();
  const past = new Date(now.getTime() - 3_600_000);
  const ids: string[] = [];
  for (const t of ["a", "b"]) {
    const [r] = await db.insert(posts).values({ accountId: account.id, kind: "post", text: t, status: "pending_approval", scheduledAt: past, contentHash: contentHash(t) }).returning();
    ids.push(r!.id);
  }
  const { eq } = await import("drizzle-orm");
  const first = await approvalTime(account, { id: ids[0]!, kind: "post", scheduledAt: past }, now);
  assert.ok(first && first.getTime() >= now.getTime(), "nie in der Vergangenheit");
  await db.update(posts).set({ status: "scheduled", scheduledAt: first! }).where(eq(posts.id, ids[0]!));
  const second = await approvalTime(account, { id: ids[1]!, kind: "post", scheduledAt: past }, now);
  assert.ok(second, "zweiter Post bekommt einen späteren Slot");
  assert.ok(Math.abs(second!.getTime() - first!.getTime()) >= 120 * 60_000, "mindestens 120 min Abstand (Bluesky)");
});

test("Antwort über dem Tageslimit bleibt in der Queue", async () => {
  const { approvalTime } = await import("../src/scheduler/slots.js");
  const { posts } = await import("../src/db/schema.js");
  const { contentHash } = await import("../src/scheduler/policy.js");
  const account = await makeAccount("bluesky");
  const now = new Date();
  await db.insert(posts).values(Array.from({ length: 30 }, (_, i) => ({ accountId: account.id, kind: "reply" as const, text: `r${i}`, status: "published" as const, scheduledAt: now, contentHash: contentHash(`r${i}`) })));
  assert.equal(await approvalTime(account, { id: "x", kind: "reply", scheduledAt: now }, now), null);
});
