import { env, need, redirectUri } from "../config.js";
import { bearer, form, http, httpJson } from "./http.js";
import type { SocialConnector, TokenSet } from "./types.js";

// Self-Serve-Produkte "Sign In with LinkedIn" + "Share on LinkedIn" → Posten aufs eigene Profil.
// Company Pages und Kommentare lesen brauchen die Community Management API (Antrag/Review).
const API = "https://api.linkedin.com";

/** LinkedIn "little text": reservierte Zeichen escapen, sonst wird der Post abgeschnitten. */
const escapeLittleText = (s: string) => s.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);

export const linkedinConnector: SocialConnector = {
  platform: "linkedin",
  capabilities: { publish: true, reply: false, readReplies: false },

  authorizeUrl(state) {
    const q = new URLSearchParams({
      response_type: "code",
      client_id: need(env.LINKEDIN_CLIENT_ID, "LINKEDIN_CLIENT_ID"),
      redirect_uri: redirectUri("linkedin"),
      state,
      scope: "openid profile w_member_social",
    });
    return `https://www.linkedin.com/oauth/v2/authorization?${q}`;
  },

  async exchangeCode(code) {
    const j = await httpJson("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      body: form({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri("linkedin"),
        client_id: need(env.LINKEDIN_CLIENT_ID, "LINKEDIN_CLIENT_ID"),
        client_secret: need(env.LINKEDIN_CLIENT_SECRET, "LINKEDIN_CLIENT_SECRET"),
      }),
    });
    // ~60 Tage gültig; Refresh-Tokens gibt es nur für freigegebene Partner → danach neu verbinden.
    const tokens: TokenSet = {
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      expiresAt: new Date(Date.now() + j.expires_in * 1000),
    };
    const me = await httpJson(`${API}/v2/userinfo`, { headers: bearer(tokens.accessToken) });
    return { tokens, externalUserId: me.sub, handle: me.name ?? me.sub };
  },

  async publish(ctx, input) {
    if (input.replyToExternalId) throw new Error("LinkedIn-Kommentare erfordern die Community Management API.");
    const res = await http(`${API}/rest/posts`, {
      method: "POST",
      headers: {
        ...bearer(ctx.tokens.accessToken),
        "Content-Type": "application/json",
        "LinkedIn-Version": env.LINKEDIN_VERSION,
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        author: `urn:li:person:${ctx.externalUserId}`,
        commentary: escapeLittleText(input.text),
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      }),
    });
    const id = res.headers.get("x-restli-id");
    if (!id) throw new Error("LinkedIn hat keine Post-ID zurückgegeben");
    return { externalId: id, url: `https://www.linkedin.com/feed/update/${id}/` };
  },
};
