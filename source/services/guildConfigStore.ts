import { GuildConfig } from "../models/GuildConfig.js";

/**
 * Cached accessor for per-guild runtime config (verified role + log channel).
 *
 * Read on every verify-button press and every role-assign/log bus action, so a
 * short in-memory cache avoids a Mongo round-trip each time. Writes happen in
 * this same bot process (`/config` commands), so we invalidate the cache
 * directly on write; the TTL is just a backstop.
 *
 * Env vars (VERIFIED_ROLE_ID, LOG_CHANNEL_ID) are bootstrap defaults — a value
 * set via `/config` overrides them.
 */

interface CachedConfig {
  verifiedRoleId: string | undefined;
  logChannelId: string | undefined;
  expiresAt: number;
}

const TTL_MS = 60_000;
const cache = new Map<string, CachedConfig>();

async function load(guildId: string): Promise<CachedConfig> {
  const now = Date.now();
  const cached = cache.get(guildId);
  if (cached && cached.expiresAt > now) return cached;

  const doc = await GuildConfig.findOne({ guildId }).lean();
  const fresh: CachedConfig = {
    verifiedRoleId: doc?.verifiedRoleId ?? undefined,
    logChannelId: doc?.logChannelId ?? undefined,
    expiresAt: now + TTL_MS,
  };
  cache.set(guildId, fresh);
  return fresh;
}

/** Invalidate the cache for a guild (call after any write). */
export function invalidateGuildConfig(guildId: string): void {
  cache.delete(guildId);
}

export interface ResolvedGuildConfig {
  verifiedRoleId: string | undefined;
  logChannelId: string | undefined;
}

/** Raw config (DB only, no env fallback) — used by `/config view`. */
export async function getGuildConfig(
  guildId: string,
): Promise<ResolvedGuildConfig> {
  const c = await load(guildId);
  return { verifiedRoleId: c.verifiedRoleId, logChannelId: c.logChannelId };
}

/**
 * Verified role ID with precedence: GuildConfig → env VERIFIED_ROLE_ID → "".
 * Returns "" when neither is set (caller surfaces a clear "not configured").
 */
export async function resolveVerifiedRoleId(guildId: string): Promise<string> {
  const c = await load(guildId);
  return (c.verifiedRoleId ?? process.env.VERIFIED_ROLE_ID ?? "").trim();
}

/** Log channel ID with precedence: GuildConfig → env LOG_CHANNEL_ID → "". */
export async function resolveLogChannelId(guildId: string): Promise<string> {
  const c = await load(guildId);
  return (c.logChannelId ?? process.env.LOG_CHANNEL_ID ?? "").trim();
}

export async function setVerifiedRole(
  guildId: string,
  roleId: string,
  updatedBy: string,
): Promise<void> {
  await GuildConfig.updateOne(
    { guildId },
    { $set: { verifiedRoleId: roleId, updatedBy, updatedAt: new Date() } },
    { upsert: true },
  );
  invalidateGuildConfig(guildId);
}

export async function setLogChannel(
  guildId: string,
  channelId: string,
  updatedBy: string,
): Promise<void> {
  await GuildConfig.updateOne(
    { guildId },
    { $set: { logChannelId: channelId, updatedBy, updatedAt: new Date() } },
    { upsert: true },
  );
  invalidateGuildConfig(guildId);
}
