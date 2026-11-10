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
