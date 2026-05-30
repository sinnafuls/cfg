import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
  time,
  type ChatInputCommandInteraction,
} from "discord.js";
import logger from "../../utils/logger.js";
import { clearBlock, isBlocked } from "../../services/blockStore.js";
import { resolveVerifiedRoleId } from "../../services/guildConfigStore.js";
import { Verification } from "../../models/Verification.js";
import { VerificationBlock } from "../../models/VerificationBlock.js";

const COLOR_INFO = 0x6366f1;
const COLOR_GOOD = 0x10b981;
const COLOR_BAD = 0xf43f5e;

/** Human-friendly labels for block reasons in admin views. */
const REASON_LABEL: Record<string, string> = {
  vpn: "VPN",
  proxy: "Proxy",
  datacenter: "Datacenter / hosting IP",
  tor: "Tor",
  fraud_score: "High risk score",
  both_apis_failed: "Checks unavailable (fail-closed)",
  multi_account: "Alt / multi-account",
};

function reasonLabel(reason: string): string {
  return REASON_LABEL[reason] ?? reason;
}

export const data = new SlashCommandBuilder()
  .setName("admin")
  .setDescription("CFG admin tools.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((s) =>
    s
      .setName("unblock")
      .setDescription("Clear a member's verification block (manual override).")
      .addUserOption((o) =>
        o
          .setName("user")
          .setDescription("The member to unblock.")
          .setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("view")
      .setDescription("Show a member's verification status and history.")
      .addUserOption((o) =>
        o
          .setName("user")
          .setDescription("The member to inspect.")
          .setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("stats")
      .setDescription("Show verification metrics for this server."),
  );

export const execute = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const sub = interaction.options.getSubcommand();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    if (sub === "unblock") {
      await handleUnblock(interaction);
    } else if (sub === "view") {
      await handleView(interaction);
    } else {
      await handleStats(interaction);
    }
  } catch (err) {
    logger.error(`[admin ${sub}] failed:`, err);
    const msg = err instanceof Error ? err.message : String(err);
    await interaction.editReply({ content: `Something went wrong: ${msg}` });
  }
};

async function handleUnblock(
  interaction: ChatInputCommandInteraction<"cached">,
): Promise<void> {
  const user = interaction.options.getUser("user", true);
  const removed = await clearBlock(user.id);
  if (removed) {
    logger.info(`[admin unblock] ${interaction.user.id} unblocked ${user.id}`);
    await interaction.editReply({
      content: `Cleared the verification block for ${user.toString()}. They can verify again now.`,
    });
  } else {
    await interaction.editReply({
      content: `${user.toString()} has no active verification block.`,
    });
  }
}

async function handleView(
  interaction: ChatInputCommandInteraction<"cached">,
): Promise<void> {
  const user = interaction.options.getUser("user", true);
  const guildId = interaction.guild.id;

  const [verification, block, recentBlocks, roleId] = await Promise.all([
    Verification.findOne({ discordId: user.id, guildId }).lean(),
    isBlocked(user.id),
    VerificationBlock.find({ discordId: user.id, guildId })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
    resolveVerifiedRoleId(guildId),
  ]);

  const member = await interaction.guild.members
    .fetch(user.id)
    .catch(() => null);
  const hasRole = Boolean(
    roleId && member && member.roles.cache.has(roleId),
  );

  const statusBits: string[] = [];
  if (!member) statusBits.push("Not in the server");
  statusBits.push(hasRole ? "✅ Has verified role" : "❌ No verified role");
  if (block) {
    statusBits.push(
      `🚫 Blocked (${reasonLabel(block.reason)}) until ${time(
        Math.floor(block.until / 1000),
        "R",
      )}`,
    );
  } else {
    statusBits.push("No active block");
  }

  const embed = new EmbedBuilder()
    .setColor(block ? COLOR_BAD : hasRole ? COLOR_GOOD : COLOR_INFO)
    .setTitle(`Verification — ${user.tag}`)
    .setThumbnail(user.displayAvatarURL())
    .addFields({ name: "Status", value: statusBits.join("\n") });

  if (verification) {
    const created = verification.createdAt
      ? time(new Date(verification.createdAt), "R")
      : "unknown";
    const lastSeen = verification.ipLastSeenAt
      ? time(new Date(verification.ipLastSeenAt), "R")
      : "unknown";
    embed.addFields({
      name: "Verification record",
      value: [
        `First verified: ${created}`,
        `IP last seen: ${lastSeen}`,
        `Risk score at verify: \`${verification.fraudScore ?? 0}\``,
        `IP hash: \`${String(verification.ipHash ?? "").slice(0, 12)}…\``,
      ].join("\n"),
    });
  } else {
    embed.addFields({
      name: "Verification record",
      value: "Never completed verification.",
    });
  }

  if (recentBlocks.length > 0) {
    const lines = recentBlocks.map((b) => {
      const when = b.createdAt ? time(new Date(b.createdAt), "d") : "?";
      const linked = b.linkedDisplayName
        ? ` → ${b.linkedDisplayName}`
        : "";
      return `${when} · ${reasonLabel(String(b.reason))}${linked}`;
    });
    embed.addFields({
      name: `Block history (${recentBlocks.length} most recent)`,
      value: lines.join("\n"),
    });
  }

  embed.setFooter({ text: `User ID: ${user.id}` });
  await interaction.editReply({ embeds: [embed] });
}

async function handleStats(
  interaction: ChatInputCommandInteraction<"cached">,
): Promise<void> {
  const guildId = interaction.guild.id;
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const since24h = new Date(now - day);
  const since7d = new Date(now - 7 * day);

  const [
    verifiedTotal,
    verified24h,
    verified7d,
    blocksTotal,
    activeBlocks,
    byReason,
  ] = await Promise.all([
    Verification.countDocuments({ guildId }),
    Verification.countDocuments({ guildId, createdAt: { $gte: since24h } }),
    Verification.countDocuments({ guildId, createdAt: { $gte: since7d } }),
    VerificationBlock.countDocuments({ guildId }),
    VerificationBlock.countDocuments({
      guildId,
      expiresAt: { $gt: new Date(now) },
    }),
    VerificationBlock.aggregate<{ _id: string; count: number }>([
      { $match: { guildId } },
      { $group: { _id: "$reason", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);

  const reasonLines =
    byReason.length > 0
      ? byReason
          .map((r) => `${reasonLabel(r._id)}: \`${r.count}\``)
          .join("\n")
      : "No blocks recorded yet.";

  const embed = new EmbedBuilder()
    .setColor(COLOR_INFO)
    .setTitle("CFG verification stats")
    .addFields(
      {
        name: "Verified",
        value: [
          `Total: \`${verifiedTotal}\``,
          `Last 24h: \`${verified24h}\``,
          `Last 7d: \`${verified7d}\``,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Blocks",
        value: [
          `Total: \`${blocksTotal}\``,
          `Currently active: \`${activeBlocks}\``,
        ].join("\n"),
        inline: true,
      },
      { name: "Blocks by reason", value: reasonLines },
    )
    .setFooter({ text: "Active = block still within its TTL window." });

  await interaction.editReply({ embeds: [embed] });
}
