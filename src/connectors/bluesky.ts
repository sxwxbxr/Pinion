import { env } from "../config.js";
import { bearer, httpJson } from "./http.js";
import type { AccountCtx, SocialConnector, TokenSet } from "./types.js";

// Bluesky (AT Protocol). Login mit Handle + App-Passwort (Einstellungen → Datenschutz und Sicherheit → App-Passwörter).
// Kein OAuth-Redirect nötig, deshalb auch kein HTTPS-Tunnel. Limit: 300 Grapheme pro Post.

interface Session {
  did: string;
  handle: string;
  accessJwt: string;
  refreshJwt: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  didDoc?: any;
}

/** Im verschlüsselten refreshToken-Feld: alles, was für eine neue Session nötig ist. */
interface StoredSecret {
  refreshJwt: string;
  identifier: string;
  appPassword: string;
  pds: string;
}

const jwtExp = (jwt: string): Date | undefined => {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? new Date(payload.exp * 1000) : undefined;
  } catch {
    return undefined;
  }
};

/** PDS des Accounts aus dem DID-Dokument; Fallback auf den Login-Service. */
export function pdsFromSession(s: Session, fallback: string): string {
  const svc = s.didDoc?.service?.find?.((x: { id?: string }) => x.id === "#atproto_pds");
  return (svc?.serviceEndpoint as string | undefined)?.replace(/\/$/, "") ?? fallback.replace(/\/$/, "");
}

function toTokens(s: Session, secret: Omit<StoredSecret, "refreshJwt">): TokenSet {
  return {
    accessToken: s.accessJwt,
    refreshToken: JSON.stringify({ ...secret, refreshJwt: s.refreshJwt } satisfies StoredSecret),
    expiresAt: jwtExp(s.accessJwt),
  };
}

const parseSecret = (t: TokenSet): StoredSecret => {
  if (!t.refreshToken) throw new Error("Bluesky-Zugangsdaten fehlen – Account neu verbinden");
  return JSON.parse(t.refreshToken) as StoredSecret;
};

async function createSession(service: string, identifier: string, password: string): Promise<Session> {
  return httpJson(`${service.replace(/\/$/, "")}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
}

// ---------- Facets: Links und Hashtags klickbar machen (Byte-Offsets in UTF-8) ----------

export interface Facet {
  index: { byteStart: number; byteEnd: number };
  features: ({ $type: "app.bsky.richtext.facet#link"; uri: string } | { $type: "app.bsky.richtext.facet#tag"; tag: string })[];
}

const utf8Len = (s: string) => Buffer.byteLength(s, "utf8");

export function buildFacets(text: string): Facet[] {
  const facets: Facet[] = [];
  const add = (start: number, match: string, feature: Facet["features"][number]) => {
    const byteStart = utf8Len(text.slice(0, start));
    facets.push({ index: { byteStart, byteEnd: byteStart + utf8Len(match) }, features: [feature] });
  };
  for (const m of text.matchAll(/https?:\/\/[^\s<>"]+/g)) {
    const url = m[0].replace(/[.,;:!?)\]]+$/, ""); // Satzzeichen am Ende gehören nicht zum Link
    add(m.index!, url, { $type: "app.bsky.richtext.facet#link", uri: url });
  }
  for (const m of text.matchAll(/(^|\s)(#[\p{L}\p{N}_]+)/gu)) {
    const tag = m[2]!;
    if (/^#\d+$/.test(tag)) continue; // "#1" ist kein Hashtag
    add(m.index! + m[1]!.length, tag, { $type: "app.bsky.richtext.facet#tag", tag: tag.slice(1) });
  }
  return facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
}

export const postUrl = (handle: string, atUri: string) => `https://bsky.app/profile/${handle}/post/${atUri.split("/").pop()}`;

async function xrpc<T = any>(ctx: AccountCtx, method: string, init?: { query?: Record<string, string>; body?: unknown }): Promise<T> {
  const { pds } = parseSecret(ctx.tokens);
  const qs = init?.query ? `?${new URLSearchParams(init.query)}` : "";
  return httpJson<T>(`${pds}/xrpc/${method}${qs}`, {
    method: init?.body ? "POST" : "GET",
    headers: { ...bearer(ctx.tokens.accessToken), ...(init?.body ? { "content-type": "application/json" } : {}) },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
}

export const blueskyConnector: SocialConnector = {
  platform: "bluesky",
  capabilities: { publish: true, reply: true, readReplies: true },
  refreshWindowSec: 10 * 60, // Access-JWT lebt nur ~2 h

  credentialFields: [
    { name: "identifier", label: "Handle", placeholder: "name.bsky.social" },
    {
      name: "appPassword",
      label: "App-Passwort",
      secret: true,
      placeholder: "xxxx-xxxx-xxxx-xxxx",
      help: "bsky.app → Einstellungen → Datenschutz und Sicherheit → App-Passwörter. Nicht dein Login-Passwort.",
    },
  ],

  async connectWithCredentials(values) {
    const identifier = values.identifier?.trim().replace(/^@/, "");
    const appPassword = values.appPassword?.trim();
    if (!identifier || !appPassword) throw new Error("Handle und App-Passwort angeben");
    const s = await createSession(env.BLUESKY_SERVICE, identifier, appPassword);
    const pds = pdsFromSession(s, env.BLUESKY_SERVICE);
    return { tokens: toTokens(s, { identifier, appPassword, pds }), externalUserId: s.did, handle: s.handle };
  },

  async refresh(prev) {
    const secret = parseSecret(prev);
    try {
      const s = await httpJson<Session>(`${secret.pds}/xrpc/com.atproto.server.refreshSession`, {
        method: "POST",
        headers: bearer(secret.refreshJwt),
      });
      return toTokens(s, secret);
    } catch {
      // Refresh-JWT abgelaufen oder widerrufen → mit App-Passwort neu einloggen
      const s = await createSession(secret.pds, secret.identifier, secret.appPassword);
      return toTokens(s, secret);
    }
  },

  async publish(ctx, input) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const record: Record<string, any> = {
      $type: "app.bsky.feed.post",
      text: input.text,
      createdAt: new Date().toISOString(),
    };
    const facets = buildFacets(input.text);
    if (facets.length) record.facets = facets;

    if (input.replyToExternalId) {
      // Antwort braucht Referenz auf direkten Parent und auf den Thread-Anfang (uri + cid)
      const { posts } = await xrpc(ctx, "app.bsky.feed.getPosts", { query: { uris: input.replyToExternalId } });
      const parent = posts?.[0];
      if (!parent) throw new Error(`Bluesky-Post ${input.replyToExternalId} nicht gefunden`);
      const parentRef = { uri: parent.uri, cid: parent.cid };
      record.reply = { root: parent.record?.reply?.root ?? parentRef, parent: parentRef };
    }

    const res = await xrpc<{ uri: string; cid: string }>(ctx, "com.atproto.repo.createRecord", {
      body: { repo: ctx.externalUserId, collection: "app.bsky.feed.post", record },
    });
    return { externalId: res.uri, url: postUrl(ctx.handle, res.uri) };
  },

  async fetchReplies(ctx, parentExternalId) {
    const j = await xrpc(ctx, "app.bsky.feed.getPostThread", { query: { uri: parentExternalId, depth: "1", parentHeight: "0" } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (j.thread?.replies ?? [])
      .map((r: any) => r.post)
      .filter((p: any) => p && p.author?.did !== ctx.externalUserId && p.record?.text)
      .map((p: any) => ({
        externalId: p.uri,
        parentExternalId,
        authorHandle: p.author.handle,
        text: p.record.text,
        createdAt: new Date(p.record.createdAt ?? p.indexedAt),
      }));
  },
};
