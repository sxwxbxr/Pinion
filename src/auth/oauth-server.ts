import { createHash, randomBytes, randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { upsertAccount } from "../accounts.js";
import { env } from "../config.js";
import { connectors } from "../connectors/index.js";
import { PLATFORMS, type Platform } from "../types.js";

/** Kleiner lokaler Server nur für den OAuth-Flow: /connect/:platform → Plattform → /callback/:platform */
const app = new Hono();
const pending = new Map<string, { platform: Platform; verifier: string; expires: number }>();
const b64url = (b: Buffer) => b.toString("base64url");
const isPlatform = (p: string): p is Platform => (PLATFORMS as readonly string[]).includes(p);

app.get("/", (c) =>
  c.html(
    `<h1>ReachPilot – Accounts verbinden</h1><ul>${PLATFORMS.map((p) => `<li><a href="/connect/${p}">${p}</a></li>`).join("")}</ul>`,
  ),
);

app.get("/connect/:platform", (c) => {
  const platform = c.req.param("platform");
  if (!isPlatform(platform)) return c.text("Unbekannte Plattform", 404);
  const state = randomUUID();
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  pending.set(state, { platform, verifier, expires: Date.now() + 10 * 60_000 });
  try {
    return c.redirect(connectors[platform].authorizeUrl(state, challenge));
  } catch (err) {
    return c.text(`Konfiguration unvollständig: ${(err as Error).message}`, 500);
  }
});

app.get("/callback/:platform", async (c) => {
  const platform = c.req.param("platform");
  const { code, state, error, error_description } = c.req.query();
  if (error) return c.text(`Abgebrochen: ${error} ${error_description ?? ""}`, 400);
  const entry = state ? pending.get(state) : undefined;
  if (!entry || entry.platform !== platform || entry.expires < Date.now() || !code) {
    return c.text("Ungültiger oder abgelaufener OAuth-State – bitte neu starten.", 400);
  }
  pending.delete(state!);
  try {
    const result = await connectors[entry.platform].exchangeCode(code, entry.verifier);
    const account = await upsertAccount(entry.platform, result);
    return c.html(`<p>✅ ${entry.platform} verbunden als <b>@${account.handle}</b> (Account-ID <code>${account.id}</code>).</p><a href="/">Zurück</a>`);
  } catch (err) {
    console.error(err);
    return c.text(`Token-Austausch fehlgeschlagen: ${(err as Error).message}`, 500);
  }
});

serve({ fetch: app.fetch, port: env.AUTH_PORT, hostname: "127.0.0.1" }, (info) =>
  console.log(`OAuth-Server: http://127.0.0.1:${info.port}  (öffentlich: ${env.PUBLIC_BASE_URL})`),
);
