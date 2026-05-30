import { randomUUID } from "node:crypto";
import { getRedis, tokenKey } from "./redis.js";

/**
 * One-time verify-link tokens in Redis with native 15-min TTL.
 *
 * issue()   — bot mints a token on a button click and SETEXes it for 900s.
 * validate()— web reads the token without consuming it (the v/[token] landing).
 * consume() — web atomically GETDELs on the OAuth callback so two concurrent
 *             callbacks can't both succeed (single-use).
 *
 * The stored value is JSON `{discordId,guildId}` — the identity the token is
 * bound to, asserted against the OAuth `/users/@me` id on the web side.
 */

const TOKEN_TTL_SECONDS = 900;

export interface TokenPayload {
  discordId: string;
  guildId: string;
}

/** Mint a single-use token bound to this Discord ID. Returns the token. */
export async function issue(
  discordId: string,
  guildId: string,
): Promise<string> {
  const token = randomUUID();
  const redis = await getRedis();
  const payload: TokenPayload = { discordId, guildId };
  await redis.setEx(tokenKey(token), TOKEN_TTL_SECONDS, JSON.stringify(payload));
  return token;
}

/** Read a token without consuming it. Returns null if missing/expired/invalid. */
export async function validate(token: string): Promise<TokenPayload | null> {
  const redis = await getRedis();
  const raw = await redis.get(tokenKey(token));
  return parsePayload(raw);
}

/**
 * Atomically read-and-delete a token (single-use). Returns the payload if the
 * token existed, or null if it was already used/expired.
 */
export async function consume(token: string): Promise<TokenPayload | null> {
  const redis = await getRedis();
  const raw = await redis.getDel(tokenKey(token));
  return parsePayload(raw);
}

function parsePayload(raw: string | null): TokenPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TokenPayload>;
    if (
      typeof parsed.discordId === "string" &&
      typeof parsed.guildId === "string"
    ) {
      return { discordId: parsed.discordId, guildId: parsed.guildId };
    }
    return null;
  } catch {
    return null;
  }
}
