/**
 * Redis pub/sub subscriber for the `cfg:verify-actions` channel.
 *
 * The web side (dashboard) publishes a request when it needs the bot to mutate
 * Discord state it can't reach over the gateway: assign the verified role after
 * a clean check, or confirm a candidate account is still a live member (used by
 * multi-account / alt detection). The bot replies by SETEXing the result under
 * `cfg:verify-actions:response:<id>` for 60s; the web polls that key.
 *
 * Modeled on perceptor's `source/services/adminActionBus.ts`. Uses a DEDICATED
 * subscriber client because the redis library puts a connection into
 * subscriber-only mode once `subscribe()` is called, making it unusable for the
 * `setEx` reply — that reply goes through the shared command client (getRedis).
 */

import { createClient, type RedisClientType } from "redis";
import type { Client } from "discord.js";
import logger from "../utils/logger.js";
import {
  getRedis,
  verifyActionResponseKey,
  VERIFY_ACTION_CHANNEL,
} from "./redis.js";

type VerifyActionType = "assign_verified_role" | "check_membership";

interface VerifyActionRequest {
  id: string;
  type: VerifyActionType;
  discordId: string;
  guildId: string;
}

let subClient: RedisClientType | null = null;

async function respond(
  id: string,
  body: { ok: boolean; message: string; data?: unknown },
): Promise<void> {
  const redis = await getRedis();
  await redis.setEx(verifyActionResponseKey(id), 60, JSON.stringify({ id, ...body }));
}

async function handleRequest(
  client: Client,
  req: VerifyActionRequest,
): Promise<void> {
  const guild = await client.guilds.fetch(req.guildId);

  if (req.type === "assign_verified_role") {
    const roleId = (process.env.VERIFIED_ROLE_ID ?? "").trim();
    if (!roleId) {
      throw new Error("VERIFIED_ROLE_ID is not configured on the bot.");
    }
    const member = await guild.members.fetch(req.discordId);
    await member.roles.add(roleId, "CFG verification passed");
    await respond(req.id, {
      ok: true,
      message: `Assigned verified role to ${req.discordId}.`,
      data: {
        inGuild: true,
        displayName: member.displayName,
        username: member.user.username,
      },
    });
    return;
  }

  if (req.type === "check_membership") {
    // Member-not-found resolves to a clean { inGuild:false } rather than an
    // error: a candidate alt who has left the guild simply isn't a conflict.
    const member = await guild.members.fetch(req.discordId).catch(() => null);
    if (!member) {
      await respond(req.id, {
        ok: true,
        message: `${req.discordId} is not in the guild.`,
        data: { inGuild: false },
      });
      return;
    }
    await respond(req.id, {
      ok: true,
      message: `${req.discordId} is in the guild.`,
      data: {
        inGuild: true,
        displayName: member.displayName,
        username: member.user.username,
      },
    });
    return;
  }

  throw new Error(`Unsupported verify action: ${String(req.type)}`);
}

/**
 * Subscribe to the verify-actions channel. Connects lazily and logs but never
 * rethrows so a Redis outage doesn't block the bot's startup sequence.
 */
export async function subscribeVerifyActions(client: Client): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url) {
    logger.warn(
      "[verifyActionBus] REDIS_URL not set - verification actions disabled.",
    );
    return;
  }

  const c = createClient({ url }) as RedisClientType;
  c.on("error", (err: unknown) => {
    logger.error("[verifyActionBus] subscriber error:", err);
  });
  c.on("reconnecting", () => {
    logger.info("[verifyActionBus] reconnecting to Redis...");
  });

  try {
    await c.connect();
  } catch (err) {
    logger.error(
      "[verifyActionBus] failed to connect - verification actions disabled:",
      err,
    );
    return;
  }

  subClient = c;
  await c.subscribe(VERIFY_ACTION_CHANNEL, (raw) => {
    let req: VerifyActionRequest;
    try {
      req = JSON.parse(raw) as VerifyActionRequest;
      if (!req.id || !req.type || !req.discordId || !req.guildId) {
        throw new Error("Malformed verify action request.");
      }
    } catch (err) {
      logger.warn("[verifyActionBus] ignored malformed message:", err);
      return;
    }

    void handleRequest(client, req).catch(async (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[verifyActionBus] ${req.type} failed:`, err);
      await respond(req.id, { ok: false, message }).catch(() => {});
    });
  });

  logger.info(`[verifyActionBus] subscribed to ${VERIFY_ACTION_CHANNEL}`);
}

/** Graceful shutdown - called from index.ts shutdown(). */
export async function closeVerifyActionBus(): Promise<void> {
  if (!subClient) return;
  try {
    await subClient.quit();
  } catch {
    // ignore shutdown errors
  }
  subClient = null;
}
