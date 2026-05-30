import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import logger from "../../utils/logger.js";
import { clearBlock } from "../../services/blockStore.js";

export const data = new SlashCommandBuilder()
  .setName("unblock")
  .setDescription("Clears a member's verification block (manual override).")
  .addUserOption((option) =>
    option
      .setName("user")
      .setDescription("The member to unblock.")
      .setRequired(true),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false);

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

  const user = interaction.options.getUser("user", true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const removed = await clearBlock(user.id);
    if (removed) {
      logger.info(
        `[unblock] ${interaction.user.id} cleared the block for ${user.id}.`,
      );
      await interaction.editReply({
        content: `Cleared the verification block for ${user.toString()}. They can verify again now.`,
      });
    } else {
      await interaction.editReply({
        content: `${user.toString()} has no active verification block.`,
      });
    }
  } catch (err) {
    logger.error("[unblock] Failed to clear block:", err);
    const msg = err instanceof Error ? err.message : String(err);
    await interaction.editReply({
      content: `Failed to clear the block: ${msg}`,
    });
  }
};
