import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** Projektwurzel – unabhängig vom cwd (wichtig, wenn Claude Desktop den MCP-Server startet). */
export const ROOT = fileURLToPath(new URL("..", import.meta.url));
const envFile = resolve(ROOT, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const bool = z.enum(["true", "false"]).default("false").transform((v) => v === "true");

const Env = z.object({
  DATABASE_URL: z.string().default("./data/reachpilot.db"),
  TOKEN_ENC_KEY: z.string().min(1),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:8787"),
  AUTH_PORT: z.coerce.number().int().default(8787),
  DEFAULT_TIMEZONE: z.string().default("Europe/Zurich"),
  APPROVAL_MODE: z.enum(["replies", "all"]).default("replies"),
  // Plattformen, auf denen auch eigene Posts erst nach Freigabe rausgehen (kommagetrennt)
  APPROVAL_POSTS_PLATFORMS: z
    .string()
    .default("reddit,devto")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
  AUTH_HOST: z.string().default("127.0.0.1"),
  WORKER_TICK_SECONDS: z.coerce.number().int().min(5).default(30),
  INBOX_POLL_MINUTES: z.coerce.number().int().min(5).default(15),
  INBOX_POLL_X: bool,

  X_CLIENT_ID: z.string().optional(),
  X_CLIENT_SECRET: z.string().optional(),
  LINKEDIN_CLIENT_ID: z.string().optional(),
  LINKEDIN_CLIENT_SECRET: z.string().optional(),
  LINKEDIN_VERSION: z.string().regex(/^\d{6}$/).default("202610"),
  THREADS_APP_ID: z.string().optional(),
  THREADS_APP_SECRET: z.string().optional(),
  REDDIT_CLIENT_ID: z.string().optional(),
  REDDIT_CLIENT_SECRET: z.string().optional(),
  REDDIT_USER_AGENT: z.string().default("web:reachpilot:v0.1.0 (by /u/your_username)"),
  BLUESKY_SERVICE: z.string().url().default("https://bsky.social"),
});

// Leere Strings aus .env wie "nicht gesetzt" behandeln
const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
const parsed = Env.safeParse(raw);
if (!parsed.success) {
  console.error(
    "Konfigurationsfehler (.env):\n" +
      parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n") +
      "\nTipp: TOKEN_ENC_KEY mit `npm run gen:key` erzeugen.",
  );
  process.exit(1);
}

export const env = { ...parsed.data, DATABASE_PATH: resolve(ROOT, parsed.data.DATABASE_URL) };

export const redirectUri = (platform: string) =>
  `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/callback/${platform}`;

export function need(value: string | undefined | null, name: string): string {
  if (!value) throw new Error(`${name} fehlt`);
  return value;
}
