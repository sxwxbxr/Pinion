import { eq } from "drizzle-orm";
import { env } from "./config.js";
import { connectors } from "./connectors/index.js";
import type { AccountCtx, TokenSet } from "./connectors/types.js";
import { decrypt, encrypt } from "./crypto/tokens.js";
import { audit, db } from "./db/client.js";
import { accounts, type Account } from "./db/schema.js";
import type { Platform } from "./types.js";

function tokenColumns(t: TokenSet) {
  return {
    accessTokenEnc: encrypt(t.accessToken),
    refreshTokenEnc: t.refreshToken ? encrypt(t.refreshToken) : null,
    tokenExpiresAt: t.expiresAt ?? null,
  };
}

export async function upsertAccount(
  platform: Platform,
  r: { tokens: TokenSet; externalUserId: string; handle: string },
): Promise<Account> {
  const cols = { handle: r.handle, ...tokenColumns(r.tokens) };
  const [row] = await db
    .insert(accounts)
    .values({ platform, externalUserId: r.externalUserId, timezone: env.DEFAULT_TIMEZONE, ...cols })
    .onConflictDoUpdate({ target: [accounts.platform, accounts.externalUserId], set: cols })
    .returning();
  audit("auth", "account_connected", { platform, handle: r.handle });
  return row!;
}

export async function getAccount(accountId: string): Promise<Account> {
  const account = await db.query.accounts.findFirst({ where: eq(accounts.id, accountId) });
  if (!account) throw new Error(`Account ${accountId} nicht gefunden – list_accounts aufrufen`);
  return account;
}

/** Entschlüsselt Tokens und erneuert sie bei Bedarf (inkl. Persistierung). */
export async function loadAccountCtx(account: Account): Promise<AccountCtx> {
  const connector = connectors[account.platform];
  let tokens: TokenSet = {
    accessToken: decrypt(account.accessTokenEnc),
    refreshToken: account.refreshTokenEnc ? decrypt(account.refreshTokenEnc) : undefined,
    expiresAt: account.tokenExpiresAt ?? undefined,
  };

  const msLeft = tokens.expiresAt ? tokens.expiresAt.getTime() - Date.now() : Infinity;
  if (msLeft < (connector.refreshWindowSec ?? 300) * 1000) {
    if (connector.refresh) {
      tokens = await connector.refresh(tokens);
      await db.update(accounts).set(tokenColumns(tokens)).where(eq(accounts.id, account.id));
    } else if (msLeft <= 0) {
      throw new Error(
        `Token für ${account.platform}/@${account.handle} abgelaufen – neu verbinden: ${env.PUBLIC_BASE_URL}/connect/${account.platform}`,
      );
    }
  }
  return { externalUserId: account.externalUserId, handle: account.handle, tokens };
}
