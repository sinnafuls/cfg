import "dotenv/config";
import {
  Client,
  Collection,
  GatewayIntentBits,
  type ClientEvents,
} from "discord.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import logger from "./utils/logger.js";
import {
  connectToDatabase,
  closeDatabaseConnection,
} from "./database/mongo.js";
import { closeRedis } from "./services/redis.js";
import {
  subscribeVerifyActions,
  closeVerifyActionBus,
} from "./services/verifyActionBus.js";
import type { Command } from "./types/command.js";
import type { EventModule } from "./types/event.js";
import "./types/client.js";
import { GUILD_ID, VERIFIED_ROLE_ID } from "./guildConfig.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function validateEnv(): void {
  const required = [
    "DISCORD_BOT_TOKEN",
    "DISCORD_CLIENT_ID",
    "MONGODB_URI",
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    logger.error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
    process.exit(1);
  }
  if (!GUILD_ID) {
    logger.error("GUILD_ID must be set.");
    process.exit(1);
  }
  if (!VERIFIED_ROLE_ID) {
    logger.error("VERIFIED_ROLE_ID must be set.");
    process.exit(1);
  }
}

validateEnv();

const client = new Client({
  // Guilds: receive guild + interaction events. GuildMembers: fetch members and
  // mutate roles for the verify action bus. No MessageContent — CFG reads no
  // message text.
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.commands = new Collection<string, Command>();

function collectFiles(
  dirPath: string,
  predicate: (f: string) => boolean,
  out: string[] = [],
): string[] {
  try {
    const entries = fs.readdirSync(dirPath);
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);
      if (fs.statSync(fullPath).isDirectory()) {
        collectFiles(fullPath, predicate, out);
      } else if (predicate(entry)) {
        out.push(fullPath);
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Error reading directory ${dirPath}: ${msg}`);
  }
  return out;
}

const isModuleFile = (f: string): boolean => {
  if (f.endsWith(".d.ts") || f.endsWith(".test.ts") || f.endsWith(".test.js"))
    return false;
  if (f.endsWith(".spec.ts") || f.endsWith(".spec.js")) return false;
  return f.endsWith(".ts") || f.endsWith(".js");
};

async function loadCommands(): Promise<void> {
  const commandsPath = path.join(__dirname, "commands");
  if (!fs.existsSync(commandsPath)) {
    logger.warn("Commands directory does not exist.");
    return;
  }

  const files = collectFiles(commandsPath, isModuleFile);

  for (const filePath of files) {
    try {
      const moduleUrl = pathToFileURL(filePath).href;
      const mod = (await import(moduleUrl)) as Partial<Command>;
      if (mod.data && typeof mod.execute === "function") {
        const command: Command = {
          data: mod.data,
          execute: mod.execute,
          ...(mod.handleSelectMenu
            ? { handleSelectMenu: mod.handleSelectMenu }
            : {}),
          ...(mod.handleModalSubmit
            ? { handleModalSubmit: mod.handleModalSubmit }
            : {}),
          ...(mod.handleButton ? { handleButton: mod.handleButton } : {}),
        };
        client.commands.set(mod.data.name, command);
        logger.info(`Loaded command: ${mod.data.name}`);
      } else {
        logger.warn(
          `Command at ${filePath} is missing "data" or "execute" export.`,
        );
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Error loading command from ${filePath}: ${msg}`);
    }
  }
}

async function loadEvents(): Promise<void> {
  const eventsPath = path.join(__dirname, "events");
  if (!fs.existsSync(eventsPath)) {
    logger.warn("Events directory does not exist.");
    return;
  }

  const files = collectFiles(eventsPath, isModuleFile);

  for (const filePath of files) {
    try {
      const moduleUrl = pathToFileURL(filePath).href;
      const mod = (await import(moduleUrl)) as Partial<EventModule>;
      if (!mod.name || typeof mod.execute !== "function") {
        logger.warn(
          `Event at ${filePath} is missing "name" or "execute" export.`,
        );
        continue;
      }

      const handler = (...args: ClientEvents[keyof ClientEvents]): void => {
        void (async () => {
          try {
            await mod.execute!(...args);
          } catch (error) {
            logger.error(`Error in event handler ${String(mod.name)}:`, error);
          }
        })();
      };

      if (mod.once) {
        client.once(mod.name, handler);
      } else {
        client.on(mod.name, handler);
      }
      logger.info(
        `Loaded event: ${String(mod.name)}${mod.once ? " (once)" : ""}`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Error loading event from ${filePath}: ${msg}`);
    }
  }
}

async function startBot(): Promise<void> {
  logger.info("Initializing CFG bot...");

  const dbConnected = await connectToDatabase();
  if (!dbConnected) {
    logger.error("Failed to connect to database after retries - exiting.");
    process.exit(1);
  }
  logger.info("Database connection established.");

  await loadCommands();
  await loadEvents();

  try {
    logger.info("Logging in to Discord...");
    await client.login(process.env.DISCORD_BOT_TOKEN);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to log in: ${msg}`);
    process.exit(1);
  }

  // Subscribe to the web -> bot verify action bus (role assignment +
  // membership checks). Logs but never throws on a Redis outage.
  await subscribeVerifyActions(client);
}

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received. Shutting down gracefully...`);
  await closeVerifyActionBus();
  await closeRedis();
  await closeDatabaseConnection();
  if (client.isReady()) await client.destroy();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("unhandledRejection", (error) => {
  logger.error("Unhandled promise rejection:", error);
});
process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception, shutting down:", error);
  void shutdown("uncaughtException");
});

await startBot();
