import { env, need, redirectUri } from "../config.js";
import { basicAuth, bearer, form, httpJson } from "./http.js";
import type { SocialConnector, TokenSet } from "./types.js";

// X API v2, OAuth 2.0 mit PKCE. Abrechnung pay-per-use: jeder Post und jeder Read kostet.
const API = "https://api.x.com/2";
const SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access"];

const clientId = () => need(env.X_CLIENT_ID, "X_CLIENT_ID");
const tokenHeaders = () => ({ Authorization: basicAuth(clientId(), need(env.X_CLIENT_SECRET, "X_CLIENT_SECRET")) });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toTokens(j: any, prev?: TokenSet): TokenSet {
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? prev?.refreshToken, // X rotiert Refresh-Tokens
    expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000) : undefined,
  };
}

export const xConnector: SocialConnector = {
  platform: "x",
  capabilities: { publish: true, reply: true, readReplies: true },
  refreshWindowSec: 300,

  authorizeUrl(state, codeChallenge) {
    const q = new URLSearchParams({
      response_type: "code",
      client_id: clientId(),
      redirect_uri: redirectUri("x"),
      scope: SCOPES.join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    return `https://x.com/i/oauth2/authorize?${q}`;
  },

  async exchangeCode(code, codeVerifier) {
    const j = await httpJson(`${API}/oauth2/token`, {
      method: "POST",
      headers: tokenHeaders(),
      body: form({ grant_type: "authorization_code", code, redirect_uri: redirectUri("x"), code_verifier: codeVerifier }),
    });
    const tokens = toTokens(j);
    const me = await httpJson(`${API}/users/me`, { headers: bearer(tokens.accessToken) });
    return { tokens, externalUserId: me.data.id, handle: me.data.username };
  },

  async refresh(prev) {
    const j = await httpJson(`${API}/oauth2/token`, {
      method: "POST",
      headers: tokenHeaders(),
      body: form({ grant_type: "refresh_token", refresh_token: need(prev.refreshToken, "X refresh_token") }),
    });
    return toTokens(j, prev);
  },

  async publish(ctx, input) {
    const body: Record<string, unknown> = { text: input.text };
    if (input.replyToExternalId) body.reply = { in_reply_to_tweet_id: input.replyToExternalId };
    const j = await httpJson(`${API}/tweets`, {
      method: "POST",
      headers: { ...bearer(ctx.tokens.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { externalId: j.data.id, url: `https://x.com/${ctx.handle}/status/${j.data.id}` };
  },

  /** Antworten im eigenen Thread. Achtung: kostet pro gelesenem Post (INBOX_POLL_X). */
  async fetchReplies(ctx, parentExternalId) {
    const q = new URLSearchParams({
      query: `conversation_id:${parentExternalId} -from:${ctx.handle}`,
      "tweet.fields": "author_id,created_at",
      expansions: "author_id",
      "user.fields": "username",
      max_results: "50",
    });
    const j = await httpJson(`${API}/tweets/search/recent?${q}`, { headers: bearer(ctx.tokens.accessToken) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const users = new Map<string, string>((j.includes?.users ?? []).map((u: any) => [u.id, u.username]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (j.data ?? []).map((t: any) => ({
      externalId: t.id,
      parentExternalId,
      authorHandle: users.get(t.author_id) ?? t.author_id,
      text: t.text,
      createdAt: new Date(t.created_at),
    }));
  },
};
