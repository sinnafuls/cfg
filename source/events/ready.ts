import { Events, ActivityType, type Client } from "discord.js";
import type { EventModule } from "../types/event.js";
import logger from "../utils/logger.js";

export const name = Events.ClientReady;
export const once = true;

export const execute: EventModule<
  typeof Events.ClientReady
>["execute"] = (client: Client<true>) => {
  logger.info(`Logged in as ${client.user.tag}`);

  client.user.setPresence({
    status: "online",
    activities: [{ name: "guarding the gate", type: ActivityType.Custom }],
  });

  logger.info("CFG bot ready.");
};
