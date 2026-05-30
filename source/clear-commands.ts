import "dotenv/config";
import { REST, Routes } from "discord.js";
import logger from "./utils/logger.js";
import { GUILD_ID } from "./guildConfig.js";

async function clearAllCommands(): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;

  if (!token || !clientId) {
    logger.error(
      "DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID is missing from .env file.",
    );
    process.exit(1);
  }

  const rest = new REST({ version: "10" }).setToken(token);

  try {
    logger.info("Clearing ALL GLOBAL commands...");
    await rest.put(Routes.applicationCommands(clientId), { body: [] });
    logger.info("Successfully cleared ALL global commands.");

    if (GUILD_ID) {
      logger.info(`Clearing ALL GUILD commands for guild (${GUILD_ID})...`);
      await rest.put(Routes.applicationGuildCommands(clientId, GUILD_ID), {
        body: [],
      });
      logger.info("Successfully cleared ALL guild commands.");
    }

    logger.info('All commands cleared. Run "npm run deploy" to re-register.');
  } catch (error) {
    logger.error("Failed to clear commands:", error);
    process.exit(1);
  }
}

await clearAllCommands();
