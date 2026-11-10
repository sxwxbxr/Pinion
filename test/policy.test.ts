import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { clearPosts, makeAccount } from "./helpers.js";
import { db } from "../src/db/client.js";
import { posts } from "../src/db/schema.js";
import { contentHash, contentProblems, postNeedsApproval, textLength, validateDraft } from "../src/scheduler/policy.js";

beforeEach(clearPosts);
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000);

test("Bluesky zählt Grapheme: 300 Emojis mit Hautton sind erlaubt", async () => {
  const account = await makeAccount("bluesky");
  const text = "👋🏽".repeat(300);
  assert.equal(textLength(text, "bluesky"), 300);
  assert.deepEqual(contentProblems({ account, kind: "post", text, scheduledAt: inHours(1) }), []);
  assert.equal(contentProblems({ account, kind: "post", text: text + "!", scheduledAt: inHours(1) }).length, 1);
});

test("Dev.to und Reddit brauchen einen Titel", async () => {
  const devto = await makeAccount("devto");
  const reddit = await makeAccount("reddit");
  assert.match(contentProblems({ account: devto, kind: "post", text: "# Hallo", scheduledAt: inHours(1) }).join(), /title/);
  const r = contentProblems({ account: reddit, kind: "post", text: "x", scheduledAt: inHours(1) }).join();
  assert.match(r, /subreddit/);
  assert.match(r, /title/);
});

test("Dev.to lehnt Antworten ab", async () => {
  const devto = await makeAccount("devto");
  assert.match(contentProblems({ account: devto, kind: "reply", text: "danke!", scheduledAt: inHours(1) }).join(), /keine Antworten/);
});

test("Freigabe für eigene Posts: Reddit und Dev.to ja, Bluesky und LinkedIn nein", () => {
  assert.equal(postNeedsApproval("reddit"), true);
  assert.equal(postNeedsApproval("devto"), true);
  assert.equal(postNeedsApproval("bluesky"), false);
  assert.equal(postNeedsApproval("linkedin"), false);
});

test("Mindestabstand und Duplikat-Sperre greifen", async () => {
  const account = await makeAccount("bluesky");
  const text = "Neues Release ist draussen";
  await db.insert(posts).values({ accountId: account.id, kind: "post", text, status: "scheduled", scheduledAt: inHours(1), contentHash: contentHash(text) });

  const gap = await validateDraft({ account, kind: "post", text: "etwas anderes", scheduledAt: inHours(2) });
  assert.match(gap.join(), /Mindestabstand/);

  const dup = await validateDraft({ account, kind: "post", text: "  NEUES release ist  draussen ", scheduledAt: inHours(10) });
  assert.match(dup.join(), /Gleicher Inhalt/);

  assert.deepEqual(await validateDraft({ account, kind: "post", text: "etwas anderes", scheduledAt: inHours(10) }), []);
});

test("LinkedIn: Tageslimit 1 Post", async () => {
  const account = await makeAccount("linkedin");
  const tomorrow9 = new Date(); tomorrow9.setDate(tomorrow9.getDate() + 1); tomorrow9.setHours(9, 0, 0, 0);
  await db.insert(posts).values({ accountId: account.id, kind: "post", text: "a", status: "published", scheduledAt: tomorrow9, contentHash: contentHash("a") });
  const later = new Date(tomorrow9.getTime() + 13 * 3_600_000);
  if (later.getDate() === tomorrow9.getDate()) {
    assert.match((await validateDraft({ account, kind: "post", text: "b", scheduledAt: later })).join(), /Tageslimit/);
  }
});
