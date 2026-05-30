import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
  MessageFlags,
  ChannelType,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import logger from "../../utils/logger.js";
import {
  getGuildConfig,
  setVerifiedRole,
  setLogChannel,
} from "../../services/guildConfigStore.js";

const ACCENT_COLOR = 0x6366f1;

export const data = new SlashCommandBuilder()
  .setName("config")
  .setDescription("Configure CFG for this server.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((s) =>
    s
      .setName("set-role")
      .setDescription("Set the role granted when a member passes verification.")
      .addRoleOption((o) =>
        o
          .setName("role")
          .setDescription("The verified role.")
          .setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("set-channel")
      .setDescription("Set the channel that receives verification logs.")
      .addChannelOption((o) =>
        o
          .setName("channel")
          .setDescription("A text channel for verification logs.")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s.setName("view").setDescription("Show the current CFG configuration."),
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
    if (sub === "set-role") {
      await handleSetRole(interaction);
    } else if (sub === "set-channel") {
      await handleSetChannel(interaction);
    } else {
      await handleView(interaction);
    }
  } catch (err) {
    logger.error(`[config ${sub}] failed:`, err);
    const msg = err instanceof Error ? err.message : String(err);
    await interaction.editReply({ content: `Something went wrong: ${msg}` });
  }
};

async function handleSetRole(
  interaction: ChatInputCommandInteraction<"cached">,
): Promise<void> {
  const role = interaction.options.getRole("role", true);

  if (role.id === interaction.guild.id) {
    await interaction.editReply({
      content: "That's the @everyone role. Pick a real role.",
    });
    return;
  }
  if ("managed" in role && role.managed) {
    await interaction.editReply({
      content:
        "That role is managed by an integration and can't be assigned manually. Pick a normal role.",
    });
    return;
  }

  const me = await interaction.guild.members.fetchMe();
  if (role.position >= me.roles.highest.position) {
    await interaction.editReply({
      content: `I can't assign **${role.name}** — it's above my highest role. Move my role above it in Server Settings → Roles, then try again.`,
    });
    return;
  }

  await setVerifiedRole(interaction.guild.id, role.id, interaction.user.id);
  logger.info(
    `[config set-role] ${interaction.user.id} set verified role to ${role.id}`,
  );
  await interaction.editReply({
    content: `Verified role set to ${role.toString()}. Members who pass verification will receive it.`,
  });
}

async function handleSetChannel(
  interaction: ChatInputCommandInteraction<"cached">,
): Promise<void> {
  const channel = interaction.options.getChannel("channel", true, [
    ChannelType.GuildText,
  ]);

  const me = await interaction.guild.members.fetchMe();
  const perms = channel.permissionsFor(me);
  const needed = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.EmbedLinks,
  ];
  if (!perms || !perms.has(needed)) {
    await interaction.editReply({
      content: `I need **View Channel**, **Send Messages**, and **Embed Links** in ${channel.toString()}. Grant those and try again.`,
    });
    return;
  }

  await setLogChannel(interaction.guild.id, channel.id, interaction.user.id);
  logger.info(
    `[config set-channel] ${interaction.user.id} set log channel to ${channel.id}`,
  );
  await interaction.editReply({
    content: `Verification logs will be posted in ${channel.toString()}.`,
  });
}

async function handleView(
  interaction: ChatInputCommandInteraction<"cached">,
): Promise<void> {
  const cfg = await getGuildConfig(interaction.guild.id);

  const roleId = cfg.verifiedRoleId ?? process.env.VERIFIED_ROLE_ID ?? "";
  const roleSource = cfg.verifiedRoleId
    ? ""
    : process.env.VERIFIED_ROLE_ID
      ? " (from env default)"
      : "";
  const roleText = roleId ? `<@&${roleId}>${roleSource}` : "*not set*";

  const channelId = cfg.logChannelId ?? process.env.LOG_CHANNEL_ID ?? "";
  const channelSource = cfg.logChannelId
    ? ""
    : process.env.LOG_CHANNEL_ID
      ? " (from env default)"
      : "";
  const channelText = channelId
    ? `<#${channelId}>${channelSource}`
    : "*not set — logging disabled*";

  const embed = new EmbedBuilder()
    .setTitle("CFG configuration")
    .setColor(ACCENT_COLOR)
    .addFields(
      { name: "Verified role", value: roleText },
      { name: "Log channel", value: channelText },
      {
        name: "VPN / proxy",
        value: [
          `Risk threshold: \`${process.env.PROXYCHECK_RISK_THRESHOLD ?? "75"}\``,
          `Block datacenters: \`${process.env.IPINFO_BLOCK_DATACENTER ?? "true"}\``,
          `Fail mode: \`${process.env.FAIL_MODE ?? "open"}\``,
        ].join("\n"),
        inline: true,
      },
      {
        name: "Multi-account",
        value: [
          `Mode: \`${process.env.MULTI_ACCOUNT_MODE ?? "block"}\``,
          `Max per IP: \`${process.env.MULTI_ACCOUNT_MAX_PER_IP ?? "1"}\``,
          `Window: \`${process.env.MULTI_ACCOUNT_IP_WINDOW_DAYS ?? "90"}d\``,
        ].join("\n"),
        inline: true,
      },
    )
    .setFooter({ text: "Role + channel are editable here; the rest are env vars." });

  await interaction.editReply({ embeds: [embed] });
}
