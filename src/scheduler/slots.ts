import { and, asc, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "../db/client.js";
import { postingSlots, type Account, type Post } from "../db/schema.js";
import { timingProblems } from "./policy.js";

const LOOKAHEAD_DAYS = 28;

/** Nächster Slot (Account-Zeitzone), der Tageslimit und Mindestabstand einhält. */
export async function nextFreeSlot(account: Account, after = new Date(), excludePostId?: string): Promise<Date | null> {
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
      if ((await timingProblems({ account, kind: "post", scheduledAt }, excludePostId)).length === 0) return scheduledAt;
    }
  }
  return null;
}

/**
 * Zeitpunkt für einen frisch freigegebenen Eintrag. Antworten und überfällige Posts gehen nicht
 * blind "jetzt" raus, sondern erst nach erneuter Prüfung von Tageslimit und Mindestabstand,
 * damit eine Bulk-Freigabe keinen Burst auslöst.
 * Gibt null zurück, wenn gerade kein gültiger Zeitpunkt existiert (Eintrag bleibt dann in der Queue).
 */
export async function approvalTime(account: Account, post: Pick<Post, "id" | "kind" | "scheduledAt">, now = new Date()): Promise<Date | null> {
  if (post.kind === "post" && post.scheduledAt.getTime() >= now.getTime()) return post.scheduledAt;
  if ((await timingProblems({ account, kind: post.kind, scheduledAt: now }, post.id)).length === 0) return now;
  return post.kind === "post" ? nextFreeSlot(account, now, post.id) : null;
}

export const fmt = (date: Date | null | undefined, tz: string) =>
  date ? DateTime.fromJSDate(date).setZone(tz).toFormat("ccc dd.LL.yyyy HH:mm ZZZZ", { locale: "de-CH" }) : null;
