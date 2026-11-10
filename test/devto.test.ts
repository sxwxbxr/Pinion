import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { mockFetch } from "./helpers.js";
import { articlePayload, devtoConnector } from "../src/connectors/devto.js";

let mock: ReturnType<typeof mockFetch> | undefined;
afterEach(() => mock?.restore());

test("Front Matter: Tags werden normalisiert und auf 4 begrenzt", () => {
  const p = articlePayload("Mein Paket", "---\ntags: TypeScript, open-source, node, mcp, extra\ncanonical_url: https://sweber.dev/a\n---\n# Hallo\n");
  assert.deepEqual(p.article.tags, ["typescript", "opensource", "node", "mcp"]);
  assert.equal(p.article.canonical_url, "https://sweber.dev/a");
  assert.equal(p.article.body_markdown, "# Hallo\n");
  assert.equal(p.article.published, true);
});

test("Ohne Front Matter bleibt der Text unverändert", () => {
  const p = articlePayload("T", "---- kein front matter");
  assert.equal(p.article.body_markdown, "---- kein front matter");
  assert.equal("tags" in p.article, false);
});

test("Artikel veröffentlichen schickt den API-Key im Header", async () => {
  mock = mockFetch(() => ({ id: 42, url: "https://dev.to/seya/mein-paket-1a2b" }));
  const res = await devtoConnector.publish({ externalUserId: "1", handle: "seya", tokens: { accessToken: "KEY" } }, { text: "# Hi", title: "Mein Paket" });
  assert.deepEqual(res, { externalId: "42", url: "https://dev.to/seya/mein-paket-1a2b" });
  assert.equal((mock.calls[0]!.init.headers as Record<string, string>)["api-key"], "KEY");
  assert.equal(mock.calls[0]!.body.article.title, "Mein Paket");
});

test("Antworten werden abgelehnt, bevor ein Request rausgeht", async () => {
  mock = mockFetch(() => ({}));
  await assert.rejects(devtoConnector.publish({ externalUserId: "1", handle: "s", tokens: { accessToken: "K" } }, { text: "x", title: "t", replyToExternalId: "abc" }));
  assert.equal(mock.calls.length, 0);
});
