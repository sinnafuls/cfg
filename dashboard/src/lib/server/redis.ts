import { createClient, type RedisClientType } from "redis";
import { env } from "$env/dynamic/private";

// ── Key / channel helpers (MUST match the bot's source/services/redis.ts) ──
// These string shapes are the contract between the bot and the web; they are
// duplicated (not shared via a package) exactly like perceptor's two
// services. Any change here must be mirrored in the bot.
export const tokenKey = (token: string) => `cfg:token:${token}`;
export const blockKey = (discordId: string) => `cfg:block:${discordId}`;

const VERIFY_ACTION_CHANNEL = "cfg:verify-actions";
const VERIFY_ACTION_RESPONSE_PREFIX = "cfg:verify-actions:response:";

// Module-level singleton for the dashboard process.
let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType> | null = null;

export async function getRedis(): Promise<RedisClientType> {
  if (client?.isReady) return client;
  if (connecting) return connecting;

  const url = env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL not set");

  connecting = (async () => {
    const c = createClient({ url }) as RedisClientType;
    c.on("error", (err: unknown) => console.error("[redis]", err));
    await c.connect();
    client = c;
    connecting = null;
    return c;
  })();

  return connecting;
}

// ── Token store (web side: validate + consume only; bot issues) ────────────

export interface TokenPayload {
  discordId: string;
  guildId: string;
}

function parseTokenPayload(raw: string | null): TokenPayload | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<TokenPayload>;
    if (typeof p.discordId === "string" && typeof p.guildId === "string") {
      return { discordId: p.discordId, guildId: p.guildId };
    }
  } catch {
    // malformed token value - treat as invalid
  }
  return null;
}

/**
 * Read a token WITHOUT consuming it. Used by the `/v/[token]` landing load to
 * validate existence/shape before showing the privacy notice. The token is
 * only consumed (single-use) in the OAuth callback.
 */
export async function getToken(token: string): Promise<TokenPayload | null> {
  const c = await getRedis();
  return parseTokenPayload(await c.get(tokenKey(token)));
}

/**
 * Atomically read-and-delete a token (redis v5 GETDEL). Single-use guarantee:
 * two concurrent callbacks racing the same token - only one gets the value,
 * the other gets null and renders the invalid page.
 */
export async function consumeToken(
  token: string,
): Promise<TokenPayload | null> {
  const c = await getRedis();
  return parseTokenPayload(await c.getDel(tokenKey(token)));
}

// ── Block store (web side: set; bot reads on the button gate) ──────────────

export interface BlockPayload {
  reason: string;
  until: number; // epoch ms
  linkedDisplayName?: string;
}

/** Set a TTL'd block for a Discord ID. `ttlSeconds` drives Redis EXPIRE. */
export async function setBlock(
  discordId: string,
  payload: BlockPayload,
  ttlSeconds: number,
): Promise<void> {
  const c = await getRedis();
  await c.setEx(blockKey(discordId), ttlSeconds, JSON.stringify(payload));
}

export async function getBlock(
  discordId: string,
): Promise<BlockPayload | null> {
  const c = await getRedis();
  const raw = await c.get(blockKey(discordId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BlockPayload;
  } catch {
    return null;
  }
}

// ── Bot ↔ web action bus (mirrors perceptor sendAdminAction) ───────────────

export type VerifyActionType = "assign_verified_role" | "check_membership";

export interface VerifyActionResponse<T = unknown> {
  id: string;
  ok: boolean;
  message: string;
  data?: T;
}

export interface CheckMembershipData {
  inGuild: boolean;
  displayName?: string;
  username?: string;
}

function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Publish an action to the bot and poll for its response, identical in shape
 * to perceptor's sendAdminAction: publish JSON on the channel, then GET the
 * per-id response key every 350ms until `timeoutMs`. On timeout the caller
 * gets `{ ok: false }` and decides how to degrade (e.g. "role syncing").
 */
async function sendVerifyAction<T = unknown>(
  type: VerifyActionType,
  payload: Record<string, unknown>,
  timeoutMs = 45_000,
): Promise<VerifyActionResponse<T>> {
  const c = await getRedis();
  const id = makeId();
  const key = `${VERIFY_ACTION_RESPONSE_PREFIX}${id}`;
  await c.del(key).catch(() => {});
  await c.publish(
    VERIFY_ACTION_CHANNEL,
    JSON.stringify({ id, type, ...payload }),
  );

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const raw = await c.get(key).catch(() => null);
    if (raw) {
      await c.del(key).catch(() => {});
      return JSON.parse(raw) as VerifyActionResponse<T>;
    }
    await sleep(350);
  }

  return {
    id,
    ok: false,
    message: "Timed out waiting for the bot to handle the verify action.",
  };
}

// ── Rate limiting (fixed window; used by hooks.server.ts) ──────────────────

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

/**
 * Fixed-window rate limit. First hit in a window does INCR (→1) then EXPIRE to
 * arm the window; subsequent hits only INCR. Fails OPEN if Redis is
 * unreachable - a verification site that hard-blocks every user the moment
 * Redis hiccups is worse than briefly losing rate limiting. The window key is
 * `cfg:rl:<key>`; callers pass a scoped key like `v:<ip>`.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const c = await getRedis().catch(() => null);
  if (!c) return { allowed: true, remaining: limit }; // fail open

  const k = `cfg:rl:${key}`;
  try {
    const count = await c.incr(k);
    if (count === 1) await c.expire(k, windowSec);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
  } catch {
    return { allowed: true, remaining: limit }; // fail open
  }
}

/** Ask the bot to add VERIFIED_ROLE_ID to a member; poll for confirmation. */
export function publishVerifyAction(
  discordId: string,
  guildId: string,
  timeoutMs?: number,
): Promise<VerifyActionResponse> {
  return sendVerifyAction(
    "assign_verified_role",
    { discordId, guildId },
    timeoutMs,
  );
}

/**
 * Ask the bot whether `discordId` is currently a live member of `guildId`,
 * and (if so) its current display name. Drives multi-account liveness checks
 * (§8.1). Uses a short timeout because it runs in a loop over candidates.
 */
export function sendCheckMembership(
  discordId: string,
  guildId: string,
  timeoutMs = 10_000,
): Promise<VerifyActionResponse<CheckMembershipData>> {
  return sendVerifyAction<CheckMembershipData>(
    "check_membership",
    { discordId, guildId },
    timeoutMs,
  );
}
