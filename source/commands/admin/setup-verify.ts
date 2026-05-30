import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type TextChannel,
  type ChatInputCommandInteraction,
} from "discord.js";
import logger from "../../utils/logger.js";
import { VERIFY_BUTTON_ID } from "../../events/interactionCreate.js";

/** CFG brand accent — indigo (#6366f1), the "guard" signal color (spec §9). */
const ACCENT_COLOR = 0x6366f1;

export const data = new SlashCommandBuilder()
  .setName("setup-verify")
  .setDescription("Posts the CFG verification panel with a Verify button.")
  .addChannelOption((option) =>
    option
      .setName("channel")
      .setDescription("Channel to post the panel in (defaults to current).")
      .addChannelTypes(ChannelType.GuildText),
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

  const channel = (interaction.options.getChannel("channel") ??
    interaction.channel) as TextChannel | null;
  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.reply({
      content: "Please choose a text channel to post the panel in.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("Verify to get access")
    .setColor(ACCENT_COLOR)
    .setDescription(
      "Press **Verify** below to get a private link. You'll sign in with Discord, " +
        "and we'll check that you're not on a VPN or proxy.\n\n" +
        "If you're on a normal connection this only takes a few seconds. " +
        "If you use a VPN, turn it off first.",
    );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(VERIFY_BUTTON_ID)
      .setLabel("Verify")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("🛡️"),
  );

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await channel.send({ embeds: [embed], components: [row] });
    await interaction.editReply({
      content: `Verification panel posted in ${channel.toString()}.`,
    });
  } catch (err) {
    logger.error("[setup-verify] Failed to post panel:", err);
    const msg = err instanceof Error ? err.message : String(err);
    await interaction.editReply({
      content: `Failed to post the panel: ${msg}`,
    });
  }
};
