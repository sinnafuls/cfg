import { createClient, type RedisClientType } from "redis";
import logger from "../utils/logger.js";

/**
 * Shared Redis command client + key/channel helpers for the CFG verification
 * flow. Modeled on perceptor's `source/services/stats.ts` getRedis() singleton.
 *
 * IMPORTANT: every constant and helper in this file is part of the cross-process
 * contract with the web side (`dashboard/src/lib/server/redis.ts`). The keys,
 * channel name, and response-key prefix MUST match exactly on both sides or the
 * token / block / role-assign handshakes silently break.
 */

// ── Key / channel contract (keep in sync with the web side) ─────────────────

/** One-time verify link token. Value: JSON `{discordId,guildId}`. TTL 900s. */
export const TOKEN_KEY_PREFIX = "cfg:token:";
/** Active 24h block by Discord ID. Value: JSON `{reason,until,...}`. TTL 86400s. */
export const BLOCK_KEY_PREFIX = "cfg:block:";
/** Rate-limit counter prefix used by the web `hooks.server.ts`. */
export const RATE_LIMIT_KEY_PREFIX = "cfg:rl:";
/** Pub/sub channel: web PUBLISHes verify actions, bot SUBSCRIBEs. */
export const VERIFY_ACTION_CHANNEL = "cfg:verify-actions";
/** Response key prefix: bot SETEXes the result, web polls GET. */
export const VERIFY_ACTION_RESPONSE_PREFIX = "cfg:verify-actions:response:";

export function tokenKey(token: string): string {
  return `${TOKEN_KEY_PREFIX}${token}`;
}

export function blockKey(discordId: string): string {
  return `${BLOCK_KEY_PREFIX}${discordId}`;
}

export function verifyActionResponseKey(id: string): string {
  return `${VERIFY_ACTION_RESPONSE_PREFIX}${id}`;
}

// ── Shared command client singleton ─────────────────────────────────────────
// One connection for the entire bot process. A subscribed connection can't run
// normal commands, so the verifyActionBus subscriber uses its OWN dedicated
// client (see verifyActionBus.ts) — this one stays in command mode.

let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType> | null = null;

export async function getRedis(): Promise<RedisClientType> {
  if (client?.isReady) return client;
  if (connecting) return connecting;

  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL not set");

  connecting = (async () => {
    const c = createClient({ url }) as RedisClientType;
    c.on("error", (err: unknown) => logger.error("[redis] client error:", err));
    await c.connect();
    client = c;
    connecting = null;
    return c;
  })();

  return connecting;
}

export async function closeRedis(): Promise<void> {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    // ignore shutdown errors
  }
  client = null;
}
