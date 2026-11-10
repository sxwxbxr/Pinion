import { env, need, redirectUri } from "../config.js";
import { form, httpJson } from "./http.js";
import type { SocialConnector, TokenSet } from "./types.js";

// Threads API (Meta). Limits pro Profil: 250 Posts / 1000 Replies pro 24 h. Redirect-URI muss HTTPS sein.
const GRAPH = "https://graph.threads.net/v1.0";
const SCOPES = ["threads_basic", "threads_content_publish", "threads_manage_replies", "threads_read_replies"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();

const appId = () => need(env.THREADS_APP_ID, "THREADS_APP_ID");
const appSecret = () => need(env.THREADS_APP_SECRET, "THREADS_APP_SECRET");

async function waitUntilReady(containerId: string, token: string) {
  for (let i = 0; i < 15; i++) {
    const s = await httpJson(`${GRAPH}/${containerId}?${qs({ fields: "status,error_message", access_token: token })}`);
    if (s.status === "FINISHED") return;
    if (s.status === "ERROR" || s.status === "EXPIRED") throw new Error(`Threads-Container ${s.status}: ${s.error_message ?? ""}`);
    await sleep(2000);
  }
  throw new Error("Threads-Container wurde nicht rechtzeitig bereit");
}

export const threadsConnector: SocialConnector = {
  platform: "threads",
  capabilities: { publish: true, reply: true, readReplies: true },
  refreshWindowSec: 3 * 24 * 3600, // Long-lived Token (60 Tage) frühzeitig verlängern

  authorizeUrl(state) {
    return `https://threads.net/oauth/authorize?${qs({
      client_id: appId(),
      redirect_uri: redirectUri("threads"),
      scope: SCOPES.join(","),
      response_type: "code",
      state,
    })}`;
  },

  async exchangeCode(code) {
    const short = await httpJson("https://graph.threads.net/oauth/access_token", {
      method: "POST",
      body: form({ client_id: appId(), client_secret: appSecret(), grant_type: "authorization_code", redirect_uri: redirectUri("threads"), code }),
    });
    const long = await httpJson(
      `https://graph.threads.net/access_token?${qs({ grant_type: "th_exchange_token", client_secret: appSecret(), access_token: short.access_token })}`,
    );
    const tokens: TokenSet = { accessToken: long.access_token, expiresAt: new Date(Date.now() + long.expires_in * 1000) };
    const me = await httpJson(`${GRAPH}/me?${qs({ fields: "id,username", access_token: tokens.accessToken })}`);
    return { tokens, externalUserId: me.id, handle: me.username };
  },

  async refresh(prev) {
    const j = await httpJson(
      `https://graph.threads.net/refresh_access_token?${qs({ grant_type: "th_refresh_token", access_token: prev.accessToken })}`,
    );
    return { accessToken: j.access_token, expiresAt: new Date(Date.now() + j.expires_in * 1000) };
  },

  async publish(ctx, input) {
    const token = ctx.tokens.accessToken;
    const container = await httpJson(`${GRAPH}/${ctx.externalUserId}/threads`, {
      method: "POST",
      body: form({ media_type: "TEXT", text: input.text, reply_to_id: input.replyToExternalId, access_token: token }),
    });
    await waitUntilReady(container.id, token);
    const published = await httpJson(`${GRAPH}/${ctx.externalUserId}/threads_publish`, {
      method: "POST",
      body: form({ creation_id: container.id, access_token: token }),
    });
    const meta = await httpJson(`${GRAPH}/${published.id}?${qs({ fields: "permalink", access_token: token })}`);
    return { externalId: published.id, url: meta.permalink };
  },

  async fetchReplies(ctx, parentExternalId) {
    const j = await httpJson(
      `${GRAPH}/${parentExternalId}/replies?${qs({ fields: "id,text,username,timestamp", access_token: ctx.tokens.accessToken })}`,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (j.data ?? [])
      .filter((r: any) => r.username !== ctx.handle && r.text)
      .map((r: any) => ({
        externalId: r.id,
        parentExternalId,
        authorHandle: r.username,
        text: r.text,
        createdAt: new Date(r.timestamp),
      }));
  },
};
