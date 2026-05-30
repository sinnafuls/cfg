import "dotenv/config";
import {
  REST,
  Routes,
  type RESTPostAPIApplicationCommandsJSONBody,
} from "discord.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import logger from "./utils/logger.js";
import { GUILD_ID } from "./guildConfig.js";
import type { Command } from "./types/command.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Guild-scoped slash-command registration for CFG (single guild). Walks the
 * `commands/` tree, collects each module's `data` builder, and PUTs the set to
 * `GUILD_ID`. Guild-scoped deploys propagate instantly (vs up to an hour for
 * global) and keep us clear of the global-command surface. Run via
 * `npm run deploy`. Mirrors perceptor's guild-scoped registration posture.
 */

function collectFiles(dirPath: string, out: string[] = []): string[] {
  try {
    for (const entry of fs.readdirSync(dirPath)) {
      const fullPath = path.join(dirPath, entry);
      if (fs.statSync(fullPath).isDirectory()) {
        collectFiles(fullPath, out);
      } else if (
        (entry.endsWith(".ts") || entry.endsWith(".js")) &&
        !entry.endsWith(".d.ts") &&
        !entry.endsWith(".test.ts") &&
        !entry.endsWith(".test.js")
      ) {
        out.push(fullPath);
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Error reading directory ${dirPath}: ${msg}`);
  }
  return out;
}

async function loadCommandData(): Promise<
  RESTPostAPIApplicationCommandsJSONBody[]
> {
  const commandsPath = path.join(__dirname, "commands");
  if (!fs.existsSync(commandsPath)) {
    logger.warn("Commands directory does not exist - nothing to deploy.");
    return [];
  }

  const bodies: RESTPostAPIApplicationCommandsJSONBody[] = [];
  for (const filePath of collectFiles(commandsPath)) {
    try {
      const mod = (await import(pathToFileURL(filePath).href)) as Partial<Command>;
      if (mod.data && typeof mod.execute === "function") {
        bodies.push(mod.data.toJSON());
        logger.info(`Collected command: ${mod.data.name}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Error loading command from ${filePath}: ${msg}`);
    }
  }
  return bodies;
}

async function main(): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!token || !clientId) {
    logger.error(
      "DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID is missing from .env file.",
    );
    process.exit(1);
  }
  if (!GUILD_ID) {
    logger.error("GUILD_ID is missing - cannot deploy guild commands.");
    process.exit(1);
  }

  const bodies = await loadCommandData();
  const rest = new REST({ version: "10" }).setToken(token);

  try {
    logger.info(
      `Deploying ${bodies.length} command(s) to guild ${GUILD_ID}...`,
    );
    await rest.put(Routes.applicationGuildCommands(clientId, GUILD_ID), {
      body: bodies,
    });
    logger.info(`Successfully deployed ${bodies.length} guild command(s).`);
  } catch (error) {
    logger.error("Failed to deploy commands:", error);
    process.exit(1);
  }
}

await main();
