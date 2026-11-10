import { createHash, randomBytes, randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { upsertAccount } from "../accounts.js";
import { env } from "../config.js";
import { connectors } from "../connectors/index.js";
import { PLATFORMS, type Platform } from "../types.js";

/**
 * Kleiner Server nur zum Verbinden von Accounts.
 * OAuth: /connect/:platform → Plattform → /callback/:platform
 * Zugangsdaten (Bluesky, Dev.to): /connect/:platform zeigt ein Formular, POST speichert verschlüsselt.
 * Lauscht standardmässig nur auf 127.0.0.1 – vom Laptop aus per `ssh -L 8787:127.0.0.1:8787 pi` öffnen.
 */
const app = new Hono();
const pending = new Map<string, { platform: Platform; verifier: string; expires: number }>();
const b64url = (b: Buffer) => b.toString("base64url");
const isPlatform = (p: string): p is Platform => (PLATFORMS as readonly string[]).includes(p);
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const page = (body: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ReachPilot</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:520px;margin:40px auto;padding:0 16px}label{display:block;margin:14px 0 4px;font-weight:600}
input{width:100%;padding:8px;font:inherit;box-sizing:border-box}small{color:#666}button{margin-top:16px;padding:8px 18px;font:inherit}</style>${body}`;

app.get("/", (c) =>
  c.html(page(`<h1>ReachPilot – Accounts verbinden</h1><ul>${PLATFORMS.map((p) => `<li><a href="/connect/${p}">${p}</a></li>`).join("")}</ul>`)),
);

const formToken = randomUUID(); // einfacher CSRF-Schutz für das Formular

app.post("/connect/:platform", async (c) => {
  const platform = c.req.param("platform");
  if (!isPlatform(platform)) return c.text("Unbekannte Plattform", 404);
  const connector = connectors[platform];
  if (!connector.connectWithCredentials) return c.text("Diese Plattform nutzt OAuth", 400);
  const body = await c.req.parseBody();
  if (body._token !== formToken) return c.text("Formular abgelaufen – Seite neu laden.", 400);
  const values = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v)]));
  try {
    const result = await connector.connectWithCredentials(values);
    const account = await upsertAccount(platform, result);
    return c.html(page(`<p>✅ ${platform} verbunden als <b>@${esc(account.handle)}</b> (Account-ID <code>${account.id}</code>).</p><a href="/">Zurück</a>`));
  } catch (err) {
    console.error(err);
    return c.html(page(`<p>❌ Verbinden fehlgeschlagen: ${esc((err as Error).message.slice(0, 300))}</p><a href="/connect/${platform}">Nochmal</a>`), 400);
  }
});

app.get("/connect/:platform", (c) => {
  const platform = c.req.param("platform");
  if (!isPlatform(platform)) return c.text("Unbekannte Plattform", 404);
  const fields = connectors[platform].credentialFields;
  if (fields) {
    const inputs = fields
      .map(
        (f) =>
          `<label for="${f.name}">${esc(f.label)}</label><input id="${f.name}" name="${f.name}" type="${f.secret ? "password" : "text"}" autocomplete="off" placeholder="${esc(f.placeholder ?? "")}" required>${f.help ? `<small>${esc(f.help)}</small>` : ""}`,
      )
      .join("");
    return c.html(page(`<h1>${platform} verbinden</h1><form method="post"><input type="hidden" name="_token" value="${formToken}">${inputs}<button>Verbinden</button></form><p><small>Wird AES-256-GCM-verschlüsselt in der lokalen Datenbank gespeichert.</small></p>`));
  }
  if (!connectors[platform].authorizeUrl) return c.text("Plattform nicht verbindbar", 400);
  const state = randomUUID();
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  pending.set(state, { platform, verifier, expires: Date.now() + 10 * 60_000 });
  try {
    return c.redirect(connectors[platform].authorizeUrl!(state, challenge));
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
    const exchange = connectors[entry.platform].exchangeCode;
    if (!exchange) return c.text("Plattform nutzt kein OAuth", 400);
    const result = await exchange.call(connectors[entry.platform], code, entry.verifier);
    const account = await upsertAccount(entry.platform, result);
    return c.html(`<p>✅ ${entry.platform} verbunden als <b>@${account.handle}</b> (Account-ID <code>${account.id}</code>).</p><a href="/">Zurück</a>`);
  } catch (err) {
    console.error(err);
    return c.text(`Token-Austausch fehlgeschlagen: ${(err as Error).message}`, 500);
  }
});

serve({ fetch: app.fetch, port: env.AUTH_PORT, hostname: env.AUTH_HOST }, (info) =>
  console.log(`Connect-Server: http://${env.AUTH_HOST}:${info.port}  (öffentlich: ${env.PUBLIC_BASE_URL})`),
);
