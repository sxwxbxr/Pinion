import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { mockFetch } from "./helpers.js";
import { blueskyConnector, buildFacets, postUrl } from "../src/connectors/bluesky.js";

let mock: ReturnType<typeof mockFetch> | undefined;
afterEach(() => mock?.restore());

const jwt = (expSec: number) =>
  ["e30", Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSec })).toString("base64url"), "sig"].join(".");
const session = { did: "did:plc:abc", handle: "seya.bsky.social", accessJwt: jwt(7200), refreshJwt: jwt(86400 * 60),
  didDoc: { service: [{ id: "#atproto_pds", serviceEndpoint: "https://pds.example/" }] } };

test("Facets: Link und Hashtag mit UTF-8-Byte-Offsets", () => {
  const text = "Grüezi 👋 neu: https://sweber.dev/x. #TypeScript #1";
  const facets = buildFacets(text);
  assert.equal(facets.length, 2);
  const enc = Buffer.from(text, "utf8");
  const [link, tag] = facets;
  assert.equal(enc.subarray(link!.index.byteStart, link!.index.byteEnd).toString(), "https://sweber.dev/x");
  assert.equal(enc.subarray(tag!.index.byteStart, tag!.index.byteEnd).toString(), "#TypeScript");
  assert.deepEqual(tag!.features[0], { $type: "app.bsky.richtext.facet#tag", tag: "TypeScript" });
});

test("Verbinden mit App-Passwort nutzt den PDS aus dem DID-Dokument", async () => {
  mock = mockFetch(() => session);
  const r = await blueskyConnector.connectWithCredentials!({ identifier: "@seya.bsky.social", appPassword: "aaaa-bbbb-cccc-dddd" });
  assert.equal(r.externalUserId, "did:plc:abc");
  assert.equal(r.handle, "seya.bsky.social");
  assert.equal(mock.calls[0]!.body.identifier, "seya.bsky.social");
  assert.equal(JSON.parse(r.tokens.refreshToken!).pds, "https://pds.example");
  assert.ok(r.tokens.expiresAt! > new Date());
});

test("Post erstellen und Antwort mit root/parent-Referenz", async () => {
  const tokens = { accessToken: "acc", refreshToken: JSON.stringify({ refreshJwt: "r", identifier: "seya", appPassword: "p", pds: "https://pds.example" }) };
  const ctx = { externalUserId: "did:plc:abc", handle: "seya.bsky.social", tokens };
  mock = mockFetch((url) => {
    if (url.includes("getPosts")) return { posts: [{ uri: "at://did:plc:x/app.bsky.feed.post/p1", cid: "cid1", record: { reply: { root: { uri: "at://root", cid: "rootcid" } } } }] };
    return { uri: "at://did:plc:abc/app.bsky.feed.post/3kxyz", cid: "c" };
  });
  const res = await blueskyConnector.publish(ctx, { text: "Danke! https://sweber.dev", replyToExternalId: "at://did:plc:x/app.bsky.feed.post/p1" });
  assert.equal(res.url, "https://bsky.app/profile/seya.bsky.social/post/3kxyz");
  const create = mock.calls.find((c) => c.url.endsWith("com.atproto.repo.createRecord"))!;
  assert.equal(create.url, "https://pds.example/xrpc/com.atproto.repo.createRecord");
  assert.equal(create.body.repo, "did:plc:abc");
  assert.deepEqual(create.body.record.reply.root, { uri: "at://root", cid: "rootcid" });
  assert.deepEqual(create.body.record.reply.parent, { uri: "at://did:plc:x/app.bsky.feed.post/p1", cid: "cid1" });
  assert.equal(create.body.record.facets.length, 1);
});

test("Refresh fällt auf App-Passwort zurück, wenn das Refresh-JWT abgelaufen ist", async () => {
  mock = mockFetch((url) =>
    url.includes("refreshSession") ? new Response("ExpiredToken", { status: 400 }) : session,
  );
  const prev = { accessToken: "old", refreshToken: JSON.stringify({ refreshJwt: "r", identifier: "seya", appPassword: "p", pds: "https://pds.example" }) };
  const next = await blueskyConnector.refresh!(prev);
  assert.equal(next.accessToken, session.accessJwt);
  assert.ok(mock.calls.some((c) => c.url.endsWith("createSession")));
});

test("Inbox: eigene Antworten werden ausgefiltert", async () => {
  const ctx = { externalUserId: "did:plc:abc", handle: "seya", tokens: { accessToken: "a", refreshToken: JSON.stringify({ pds: "https://pds.example" }) } };
  mock = mockFetch(() => ({ thread: { replies: [
    { post: { uri: "at://1", author: { did: "did:plc:other", handle: "fan.bsky.social" }, record: { text: "Cool!", createdAt: "2026-11-10T10:00:00Z" } } },
    { post: { uri: "at://2", author: { did: "did:plc:abc", handle: "seya" }, record: { text: "Danke", createdAt: "2026-11-10T10:05:00Z" } } },
  ] } }));
  const replies = await blueskyConnector.fetchReplies!(ctx, "at://parent");
  assert.equal(replies.length, 1);
  assert.equal(replies[0]!.authorHandle, "fan.bsky.social");
  assert.equal(postUrl("a.b", "at://did/app.bsky.feed.post/zz"), "https://bsky.app/profile/a.b/post/zz");
});
