import { and, asc, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "../db/client.js";
import { postingSlots, type Account } from "../db/schema.js";
import { timingProblems } from "./policy.js";

const LOOKAHEAD_DAYS = 28;

/** Nächster Slot (Account-Zeitzone), der Tageslimit und Mindestabstand einhält. */
export async function nextFreeSlot(account: Account, after = new Date()): Promise<Date | null> {
  const slots = await db
    .select()
    .from(postingSlots)
    .where(and(eq(postingSlots.accountId, account.id), eq(postingSlots.enabled, true)))
    .orderBy(asc(postingSlots.time));
  if (slots.length === 0) return null;

  const now = DateTime.fromJSDate(after).setZone(account.timezone);
  for (let d = 0; d < LOOKAHEAD_DAYS; d++) {
    const day = now.startOf("day").plus({ days: d });
    for (const s of slots.filter((s) => s.weekday === day.weekday)) {
      const [hour, minute] = s.time.split(":").map(Number);
      const candidate = day.set({ hour, minute });
      if (candidate <= now) continue;
      const scheduledAt = candidate.toJSDate();
      if ((await timingProblems({ account, kind: "post", scheduledAt })).length === 0) return scheduledAt;
    }
  }
  return null;
}

export const fmt = (date: Date | null | undefined, tz: string) =>
  date ? DateTime.fromJSDate(date).setZone(tz).toFormat("ccc dd.LL.yyyy HH:mm ZZZZ", { locale: "de-CH" }) : null;
