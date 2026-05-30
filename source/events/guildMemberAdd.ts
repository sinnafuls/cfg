import { Events, type GuildMember } from "discord.js";
import type { EventModule } from "../types/event.js";
import logger from "../utils/logger.js";
import { GUILD_ID } from "../guildConfig.js";

export const name = Events.GuildMemberAdd;
export const once = false;

/**
 * Re-verification on rejoin.
 *
 * Discord removes all roles when a member leaves, so a rejoining member no
 * longer holds VERIFIED_ROLE_ID — the verify-button role check forces a fresh
 * verification automatically. We deliberately NEVER auto-restore the role from
 * the old Verification record, and an active `cfg:block:<id>` (keyed by user)
 * survives the leave/rejoin, so a blocked user can't reset the 24h timer.
 *
 * Here we only send a best-effort DM nudging the member toward the verify panel.
 * DM failures (closed DMs) are swallowed — they must not break the join flow.
 */
export const execute: EventModule<
  typeof Events.GuildMemberAdd
>["execute"] = async (member: GuildMember) => {
  if (GUILD_ID && member.guild.id !== GUILD_ID) return;
  if (member.user.bot) return;

  try {
    await member.send(
      "Welcome! To access this server you'll need to verify. " +
        "Head to the verification channel and click the **Verify** button to get started.",
    );
  } catch {
    // Member has DMs closed — the static verify panel still covers them.
    logger.debug(
      `[guildMemberAdd] Could not DM verify nudge to ${member.id} (DMs likely closed).`,
    );
  }
};
