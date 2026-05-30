import { getRedis, blockKey } from "./redis.js";
import type { VerificationBlockReason } from "../models/VerificationBlock.js";

/**
 * Fast 24h (or configurable) block check in Redis with native TTL.
 *
 * The web side SETEXes a block when a verification is flagged (VPN/proxy) or a
 * multi-account conflict is detected; the bot's button handler GETs it to refuse
 * re-issuing a link. The key is `cfg:block:<discordId>` — keyed by user, not
 * membership, so a block survives a leave/rejoin (can't be reset by rejoining).
 */

export interface BlockPayload {
  reason: VerificationBlockReason;
  /** Epoch ms when the block expires (for the Discord relative timestamp). */
  until: number;
  /** multi_account: name of the existing account, shown to the blocked user. */
  linkedDisplayName?: string;
}

/** Return the active block for this user, or null if none. */
export async function isBlocked(
  discordId: string,
): Promise<BlockPayload | null> {
  const redis = await getRedis();
  const raw = await redis.get(blockKey(discordId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BlockPayload>;
    if (
      typeof parsed.reason === "string" &&
      typeof parsed.until === "number"
    ) {
      const payload: BlockPayload = {
        reason: parsed.reason as VerificationBlockReason,
        until: parsed.until,
      };
      if (typeof parsed.linkedDisplayName === "string") {
        payload.linkedDisplayName = parsed.linkedDisplayName;
      }
      return payload;
    }
    return null;
  } catch {
    return null;
  }
}

/** Set a block with a TTL in seconds. */
export async function setBlock(
  discordId: string,
  payload: BlockPayload,
  ttlSeconds: number,
): Promise<void> {
  const redis = await getRedis();
  await redis.setEx(blockKey(discordId), ttlSeconds, JSON.stringify(payload));
}

/** Remove a block (admin /unblock override). Returns true if one was removed. */
export async function clearBlock(discordId: string): Promise<boolean> {
  const redis = await getRedis();
  const removed = await redis.del(blockKey(discordId));
  return removed > 0;
}
