import { runMigrations } from "../src/db/migrate.js";
import { db } from "../src/db/client.js";
import { accounts, posts, type Account } from "../src/db/schema.js";
import { encrypt } from "../src/crypto/tokens.js";
import type { Platform } from "../src/types.js";

runMigrations();

export async function makeAccount(platform: Platform, handle = "seya"): Promise<Account> {
  const [row] = await db
    .insert(accounts)
    .values({ platform, handle, externalUserId: `${platform}-${handle}-${Math.random()}`, accessTokenEnc: encrypt("tok"), timezone: "Europe/Zurich" })
    .returning();
  return row!;
}

export async function clearPosts() {
  await db.delete(posts);
}

/** Ersetzt fetch für einen Test; gibt die aufgezeichneten Requests zurück. */
export function mockFetch(handler: (url: string, init: RequestInit) => unknown | Promise<unknown>) {
  const calls: { url: string; init: RequestInit; body?: any }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const body = typeof init.body === "string" ? safeJson(init.body) : undefined;
    calls.push({ url, init, body });
    const out = await handler(url, init);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

const safeJson = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};
