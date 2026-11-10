import type { Platform } from "../types.js";

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
}

export interface AccountCtx {
  externalUserId: string;
  handle: string;
  tokens: TokenSet;
}

export interface PublishInput {
  text: string;
  title?: string | null; // Reddit
  subreddit?: string | null; // Reddit
  replyToExternalId?: string | null;
}

export interface PublishResult {
  externalId: string;
  url?: string;
}

export interface FetchedReply {
  externalId: string;
  parentExternalId: string;
  authorHandle: string;
  text: string;
  createdAt: Date;
}

export interface SocialConnector {
  platform: Platform;
  /** Was die offizielle API mit den beantragten Scopes erlaubt. */
  capabilities: { publish: boolean; reply: boolean; readReplies: boolean };
  /** Wie lange vor Ablauf ein Token erneuert wird (Sekunden). */
  refreshWindowSec?: number;

  authorizeUrl(state: string, codeChallenge: string): string;
  exchangeCode(
    code: string,
    codeVerifier: string,
  ): Promise<{ tokens: TokenSet; externalUserId: string; handle: string }>;
  refresh?(tokens: TokenSet): Promise<TokenSet>;

  publish(ctx: AccountCtx, input: PublishInput): Promise<PublishResult>;
  fetchReplies?(ctx: AccountCtx, parentExternalId: string): Promise<FetchedReply[]>;
}
