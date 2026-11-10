import { env, need, redirectUri } from "../config.js";
import { basicAuth, bearer, form, httpJson } from "./http.js";
import type { SocialConnector, TokenSet } from "./types.js";

// Reddit Data API – neue Zugänge nur nach Freigabe (Responsible Builder Policy).
// Keine Vote-/Karma-Manipulation, kein identischer Content über mehrere Subreddits.
const OAUTH = "https://oauth.reddit.com";
const ua = () => ({ "User-Agent": env.REDDIT_USER_AGENT });
const clientAuth = () =>
  basicAuth(need(env.REDDIT_CLIENT_ID, "REDDIT_CLIENT_ID"), need(env.REDDIT_CLIENT_SECRET, "REDDIT_CLIENT_SECRET"));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toTokens = (j: any, prev?: TokenSet): TokenSet => ({
  accessToken: j.access_token,
  refreshToken: j.refresh_token ?? prev?.refreshToken,
  expiresAt: new Date(Date.now() + j.expires_in * 1000),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function assertNoErrors(j: any) {
  const errors: string[][] = j?.json?.errors ?? [];
  if (errors.length) throw new Error(`Reddit: ${errors.map((e) => e.join(" ")).join("; ")}`);
}

export const redditConnector: SocialConnector = {
  platform: "reddit",
  capabilities: { publish: true, reply: true, readReplies: true },
  refreshWindowSec: 300,

  authorizeUrl(state) {
    const q = new URLSearchParams({
      client_id: need(env.REDDIT_CLIENT_ID, "REDDIT_CLIENT_ID"),
      response_type: "code",
      state,
      redirect_uri: redirectUri("reddit"),
      duration: "permanent",
      scope: "identity submit read",
    });
    return `https://www.reddit.com/api/v1/authorize?${q}`;
  },

  async exchangeCode(code) {
    const j = await httpJson("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: { ...ua(), Authorization: clientAuth() },
      body: form({ grant_type: "authorization_code", code, redirect_uri: redirectUri("reddit") }),
    });
    const tokens = toTokens(j);
    const me = await httpJson(`${OAUTH}/api/v1/me`, { headers: { ...ua(), ...bearer(tokens.accessToken) } });
    return { tokens, externalUserId: me.id, handle: me.name };
  },

  async refresh(prev) {
    const j = await httpJson("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: { ...ua(), Authorization: clientAuth() },
      body: form({ grant_type: "refresh_token", refresh_token: need(prev.refreshToken, "Reddit refresh_token") }),
    });
    return toTokens(j, prev);
  },

  async publish(ctx, input) {
    const headers = { ...ua(), ...bearer(ctx.tokens.accessToken) };
    if (input.replyToExternalId) {
      const j = await httpJson(`${OAUTH}/api/comment`, {
        method: "POST",
        headers,
        body: form({ api_type: "json", thing_id: input.replyToExternalId, text: input.text }),
      });
      assertNoErrors(j);
      const d = j.json.data.things[0].data;
      return { externalId: d.name, url: `https://www.reddit.com${d.permalink}` };
    }
    const j = await httpJson(`${OAUTH}/api/submit`, {
      method: "POST",
      headers,
      body: form({
        api_type: "json",
        kind: "self",
        sr: need(input.subreddit, "subreddit"),
        title: need(input.title, "title"),
        text: input.text,
      }),
    });
    assertNoErrors(j);
    return { externalId: j.json.data.name, url: j.json.data.url };
  },

  async fetchReplies(ctx, parentExternalId) {
    const id = parentExternalId.replace(/^t3_/, "");
    const j = await httpJson(`${OAUTH}/comments/${id}?depth=1&limit=100&raw_json=1`, {
      headers: { ...ua(), ...bearer(ctx.tokens.accessToken) },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (j[1]?.data?.children ?? [])
      .filter((c: any) => c.kind === "t1" && c.data.author !== ctx.handle)
      .map((c: any) => ({
        externalId: c.data.name,
        parentExternalId,
        authorHandle: c.data.author,
        text: c.data.body,
        createdAt: new Date(c.data.created_utc * 1000),
      }));
  },
};
