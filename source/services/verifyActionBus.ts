/**
 * Redis pub/sub subscriber for the `cfg:verify-actions` channel.
 *
 * The web side (dashboard) publishes a request when it needs the bot to do
 * something it can't reach over the gateway:
 *   - assign_verified_role : grant the verified role after a clean check;
 *   - check_membership     : confirm a candidate account is still a live member
 *                            (multi-account / alt detection);
 *   - log_event            : post a verification log embed to the guild's
 *                            configured log channel (fire-and-forget).
 *
 * The bot replies by SETEXing the result under `cfg:verify-actions:response:<id>`
 * for 60s; the web polls that key (or ignores it, for fire-and-forget logs).
 *
 * Modeled on perceptor's `source/services/adminActionBus.ts`. Uses a DEDICATED
 * subscriber client because the redis library puts a connection into
 * subscriber-only mode once `subscribe()` is called, making it unusable for the
 * `setEx` reply — that reply goes through the shared command client (getRedis).
 */

import { createClient, type RedisClientType } from "redis";
import {
  EmbedBuilder,
  time,
  type Client,
  type TextChannel,
} from "discord.js";
import logger from "../utils/logger.js";
import {
  getRedis,
  verifyActionResponseKey,
  VERIFY_ACTION_CHANNEL,
} from "./redis.js";
import {
  resolveVerifiedRoleId,
  resolveLogChannelId,
} from "./guildConfigStore.js";

type VerifyActionType =
  | "assign_verified_role"
  | "check_membership"
  | "log_event";

/** Outcome categories the web reports for the log feed. */
type LogOutcome = "verified" | "blocked" | "duplicate" | "error";

interface VerifyActionRequest {
  id: string;
  type: VerifyActionType;
  discordId: string;
  guildId: string;
  /** log_event payload. */
  log?: {
    outcome: LogOutcome;
    username?: string;
    /** Block/duplicate reason key (vpn, proxy, datacenter, tor, multi_account, ...). */
    reason?: string;
    /** Risk score at decision time. */
    risk?: number;
    /** Coarse connection type (mobile/corporate/education/""). */
    connType?: string;
    /** multi_account: the existing linked account. */
    linkedDiscordId?: string;
    linkedDisplayName?: string;
    /** Country code from ipinfo, if available. */
    country?: string;
    /** Block expiry epoch ms, if applicable. */
    until?: number;
  };
}

const GREEN = 0x10b981;
const RED = 0xf43f5e;
const AMBER = 0xf59e0b;

const REASON_LABEL: Record<string, string> = {
  vpn: "VPN",
  proxy: "Proxy",
  datacenter: "Datacenter / hosting IP",
  tor: "Tor",
  fraud_score: "High risk score",
  both_apis_failed: "Checks unavailable (fail-closed)",
  multi_account: "Alt / multi-account",
};

let subClient: RedisClientType | null = null;

async function respond(
  id: string,
  body: { ok: boolean; message: string; data?: unknown },
): Promise<void> {
  const redis = await getRedis();
  await redis.setEx(
    verifyActionResponseKey(id),
    60,
    JSON.stringify({ id, ...body }),
  );
}

async function handleLogEvent(
  client: Client,
  req: VerifyActionRequest,
): Promise<void> {
  const log = req.log;
  if (!log) return;

  const channelId = await resolveLogChannelId(req.guildId);
  if (!channelId) return; // logging not configured — silently skip

  const guild = await client.guilds.fetch(req.guildId);
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    logger.warn(
      `[verifyActionBus] log channel ${channelId} missing or not text-based.`,
    );
    return;
  }

  const userMention = `<@${req.discordId}>`;
  const tag = log.username ? ` (${log.username})` : "";

  const embed = new EmbedBuilder().setTimestamp(new Date()).setFooter({
    text: `User ID: ${req.discordId}`,
  });

  if (log.outcome === "verified") {
    embed
      .setColor(GREEN)
      .setTitle("✅ Verified")
      .setDescription(`${userMention}${tag} passed verification.`);
    if (log.connType) {
      embed.addFields({
        name: "Connection",
        value: log.connType,
        inline: true,
      });
    }
  } else if (log.outcome === "blocked") {
    embed
      .setColor(RED)
      .setTitle("🚫 Blocked")
      .setDescription(`${userMention}${tag} was blocked.`)
      .addFields({
        name: "Reason",
        value: REASON_LABEL[log.reason ?? ""] ?? log.reason ?? "Unknown",
        inline: true,
      });
    if (typeof log.risk === "number") {
      embed.addFields({
        name: "Risk",
        value: `\`${log.risk}\``,
        inline: true,
      });
    }
    if (log.until) {
      embed.addFields({
        name: "Until",
        value: time(Math.floor(log.until / 1000), "R"),
        inline: true,
      });
    }
  } else if (log.outcome === "duplicate") {
    const linked = log.linkedDiscordId
      ? `<@${log.linkedDiscordId}>${log.linkedDisplayName ? ` (${log.linkedDisplayName})` : ""}`
      : (log.linkedDisplayName ?? "another account");
    embed
      .setColor(RED)
      .setTitle("👥 Alt blocked")
      .setDescription(
        `${userMention}${tag} was blocked as an alt of ${linked}.`,
      );
  } else {
    embed
      .setColor(AMBER)
      .setTitle("⚠️ Verification error")
      .setDescription(`${userMention}${tag} hit an error during verification.`);
    if (log.reason) {
      embed.addFields({ name: "Detail", value: log.reason, inline: true });
    }
  }

  if (log.country) {
    embed.addFields({ name: "Country", value: log.country, inline: true });
  }

  await (channel as TextChannel).send({ embeds: [embed] });
}

async function handleRequest(
  client: Client,
  req: VerifyActionRequest,
): Promise<void> {
  if (req.type === "log_event") {
    // Fire-and-forget: still ack so the web's optional poll can resolve, but
    // a failed/missing channel must never fail a verification.
    await handleLogEvent(client, req).catch((err: unknown) => {
      logger.error("[verifyActionBus] log_event post failed:", err);
    });
    await respond(req.id, { ok: true, message: "logged" });
    return;
  }

  const guild = await client.guilds.fetch(req.guildId);

  if (req.type === "assign_verified_role") {
    const roleId = await resolveVerifiedRoleId(req.guildId);
    if (!roleId) {
      throw new Error(
        "No verified role configured. Set one with /config set-role (or VERIFIED_ROLE_ID).",
      );
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
