import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * GuildConfig — runtime, admin-editable configuration for a guild.
 *
 * Lets staff set the verified role and the verification log channel from
 * Discord (`/config set-role`, `/config set-channel`) instead of redeploying
 * with new env vars. Env values (`VERIFIED_ROLE_ID`, `LOG_CHANNEL_ID`) act as
 * bootstrap defaults; a value set here overrides them.
 *
 * Bot-owned: only the bot reads/writes this. The web never needs it — role
 * assignment and log posting both happen on the bot via the Redis action bus.
 */
const guildConfigSchema = new Schema(
  {
    guildId: { type: String, required: true, unique: true },
    /** Role granted on a clean verification. Overrides env VERIFIED_ROLE_ID. */
    verifiedRoleId: { type: String },
    /** Channel that receives verification log embeds. Overrides env LOG_CHANNEL_ID. */
    logChannelId: { type: String },
    /** Discord ID of the admin who last changed config (audit). */
    updatedBy: { type: String },
    updatedAt: { type: Date, required: true, default: Date.now },
  },
  { collection: "guildconfigs" },
);

export type GuildConfigDoc = InferSchemaType<typeof guildConfigSchema>;

export const GuildConfig: Model<GuildConfigDoc> =
  (mongoose.models.GuildConfig as Model<GuildConfigDoc> | undefined) ??
  mongoose.model<GuildConfigDoc>("GuildConfig", guildConfigSchema);
