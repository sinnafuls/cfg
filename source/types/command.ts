import type {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder,
  SlashCommandOptionsOnlyBuilder,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  ButtonInteraction,
} from "discord.js";

export type CommandData =
  | SlashCommandBuilder
  | SlashCommandSubcommandsOnlyBuilder
  | SlashCommandOptionsOnlyBuilder
  | Omit<SlashCommandBuilder, "addSubcommand" | "addSubcommandGroup">;

export interface Command {
  data: CommandData;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  /** When true, this command is registered globally instead of per-guild. */
  global?: boolean;
  handleSelectMenu?: (
    interaction: StringSelectMenuInteraction,
  ) => Promise<void>;
  handleModalSubmit?: (interaction: ModalSubmitInteraction) => Promise<void>;
  handleButton?: (interaction: ButtonInteraction) => Promise<void>;
}
