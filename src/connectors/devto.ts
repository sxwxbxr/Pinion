import { httpJson } from "./http.js";
import type { SocialConnector } from "./types.js";

// Dev.to (Forem API v1). Login per API-Key (dev.to/settings/extensions → "DEV Community API Keys").
// Posts sind Artikel in Markdown: `title` ist Pflicht, Tags (max. 4) über Front Matter im Text, z.B.
//   ---
//   tags: typescript, opensource
//   ---
// Kommentare kann die API lesen, aber nicht schreiben → reply: false.
const API = "https://dev.to/api";
const headers = (key: string) => ({ "api-key": key, accept: "application/vnd.forem.api-v1+json", "content-type": "application/json" });

/** Trennt optionales Front Matter (nur `tags`, `canonical_url`, `cover_image`, `series`, `description`) vom Markdown. */
export function splitFrontMatter(md: string): { meta: Record<string, string>; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: md };
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = line.match(/^\s*([a-z_]+)\s*:\s*(.*)$/i);
    if (kv) meta[kv[1]!.toLowerCase()] = kv[2]!.trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: md.slice(m[0].length) };
}

export function articlePayload(title: string, markdown: string) {
  const { meta, body } = splitFrontMatter(markdown);
  const tags = (meta.tags ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter(Boolean)
    .slice(0, 4);
  return {
    article: {
      title,
      body_markdown: body,
      published: true,
      ...(tags.length ? { tags } : {}),
      ...(meta.canonical_url ? { canonical_url: meta.canonical_url } : {}),
      ...(meta.cover_image ? { main_image: meta.cover_image } : {}),
      ...(meta.series ? { series: meta.series } : {}),
      ...(meta.description ? { description: meta.description } : {}),
    },
  };
}

export const devtoConnector: SocialConnector = {
  platform: "devto",
  capabilities: { publish: true, reply: false, readReplies: true },

  credentialFields: [
    {
      name: "apiKey",
      label: "API-Key",
      secret: true,
      help: "dev.to/settings/extensions → DEV Community API Keys → Generate API Key",
    },
  ],

  async connectWithCredentials(values) {
    const apiKey = values.apiKey?.trim();
    if (!apiKey) throw new Error("API-Key angeben");
    const me = await httpJson(`${API}/users/me`, { headers: headers(apiKey) });
    return { tokens: { accessToken: apiKey }, externalUserId: String(me.id), handle: me.username };
  },

  async publish(ctx, input) {
    if (input.replyToExternalId) throw new Error("Dev.to-API kann keine Kommentare schreiben");
    if (!input.title) throw new Error("Dev.to-Artikel braucht einen Titel");
    const res = await httpJson(`${API}/articles`, {
      method: "POST",
      headers: headers(ctx.tokens.accessToken),
      body: JSON.stringify(articlePayload(input.title, input.text)),
    });
    return { externalId: String(res.id), url: res.url };
  },

  async fetchReplies(ctx, parentExternalId) {
    // Liefert einen Kommentarbaum; wir nehmen nur direkte Kommentare unter dem Artikel.
    const list = await httpJson(`${API}/comments?${new URLSearchParams({ a_id: parentExternalId })}`, {
      headers: headers(ctx.tokens.accessToken),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (list ?? [])
      .filter((c: any) => c.user?.username !== ctx.handle && c.body_html)
      .map((c: any) => ({
        externalId: c.id_code,
        parentExternalId,
        authorHandle: c.user.username,
        text: String(c.body_html).replace(/<[^>]+>/g, "").trim(),
        createdAt: new Date(c.created_at),
      }));
  },
};
