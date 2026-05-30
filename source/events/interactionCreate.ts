import {
  Events,
  MessageFlags,
  type Interaction,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
} from "discord.js";
import type { EventModule } from "../types/event.js";
import logger from "../utils/logger.js";
import { VERIFIED_ROLE_ID } from "../guildConfig.js";
import { isBlocked } from "../services/blockStore.js";
import { issue } from "../services/tokenStore.js";

/** customId of the persistent "Verify" button posted by /setup-verify. */
export const VERIFY_BUTTON_ID = "cfg_request_verify";

export const name = Events.InteractionCreate;
export const once = false;

async function handleCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const command = interaction.client.commands.get(interaction.commandName);
  if (!command) {
    logger.warn(
      `[interactionCreate] Unknown command: ${interaction.commandName}`,
    );
    await interaction.reply({
      content: "Unknown command.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await command.execute(interaction);
}

/**
 * The verify button gate. Mirrors spec §7:
 *  1. already has the verified role -> nothing to do.
 *  2. an active block -> reason-specific refusal (no link issued).
 *  3. otherwise -> mint a single-use token and hand back the verify link.
 */
async function handleVerifyButton(
  interaction: ButtonInteraction,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: "This button can only be used in a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 1. Already verified — Discord strips roles on leave, so holding the role
  //    means this membership is already verified.
  if (VERIFIED_ROLE_ID && interaction.member.roles.cache.has(VERIFIED_ROLE_ID)) {
    await interaction.reply({
      content: "You're already verified.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // 2. Active block — refuse with a reason-specific message and issue no link.
  const block = await isBlocked(interaction.user.id);
  if (block) {
    if (block.reason === "multi_account") {
      const name = block.linkedDisplayName
        ? ` (**${block.linkedDisplayName}**)`
        : "";
      await interaction.editReply({
        content: `You already have a verified account in this server${name}. Contact staff if this is a mistake.`,
      });
      return;
    }
    // VPN/proxy/etc — show the unblock time as a Discord relative timestamp.
    const untilSeconds = Math.floor(block.until / 1000);
    await interaction.editReply({
      content: `You're blocked from verifying until <t:${untilSeconds}:R>. This usually means a VPN/proxy was detected — disconnect it and try again after the block lifts.`,
    });
    return;
  }

  // 3. Mint a single-use token and return the verify link.
  const webBaseUrl = (process.env.WEB_BASE_URL ?? "").replace(/\/+$/, "");
  if (!webBaseUrl) {
    logger.error("[interactionCreate] WEB_BASE_URL is not configured.");
    await interaction.editReply({
      content: "Verification is misconfigured right now. Please contact staff.",
    });
    return;
  }

  const token = await issue(interaction.user.id, interaction.guildId);
  await interaction.editReply({
    content: `Click to verify (valid for 15 minutes, single use):\n${webBaseUrl}/v/${token}`,
  });
}

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  if (interaction.customId === VERIFY_BUTTON_ID) {
    await handleVerifyButton(interaction);
    return;
  }

  // Fallback: delegate to the matching command's handleButton.
  const [prefix] = interaction.customId.split(":");
  const command = prefix ? interaction.client.commands.get(prefix) : undefined;
  if (command?.handleButton) {
    await command.handleButton(interaction);
    return;
  }

  logger.warn(
    `[interactionCreate] Unhandled button customId: ${interaction.customId}`,
  );
  await interaction.reply({
    content: "Unknown button.",
    flags: MessageFlags.Ephemeral,
  });
}

export const execute: EventModule<
  typeof Events.InteractionCreate
>["execute"] = async (interaction: Interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
    } else if (interaction.isButton()) {
      await handleButton(interaction);
    }
  } catch (err) {
    // 10062 (Unknown interaction) means the token expired before we could ack
    // (>3s event-loop stall). No recovery — log a one-liner instead of a stack.
    const isUnknownInteraction =
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      err.code === 10062;
    if (isUnknownInteraction) {
      logger.warn(
        "[interactionCreate] Interaction expired before ack (10062).",
      );
      return;
    }
    logger.error("[interactionCreate] Unhandled error:", err);
    const msg =
      err instanceof Error ? err.message : "An unexpected error occurred.";
    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: msg }).catch(() => undefined);
      } else {
        await interaction
          .reply({ content: msg, flags: MessageFlags.Ephemeral })
          .catch(() => undefined);
      }
    }
  }
};
