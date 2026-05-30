import type { Awaitable, ClientEvents } from "discord.js";

export interface EventModule<
  K extends keyof ClientEvents = keyof ClientEvents,
> {
  name: K;
  once?: boolean;
  execute: (...args: ClientEvents[K]) => Awaitable<void>;
}
