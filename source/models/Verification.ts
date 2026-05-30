import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * Verification — one successful verification per user per guild.
 *
 * Durable audit + de-dupe + alt detection. Written by the web side on a CLEAN
 * verification (upsert on `{discordId,guildId}`); read by multi-account
 * detection (`{guildId,ipHash}`).
 *
 * Canonical schema lives here in the bot; the dashboard re-declares a matching
 * strict schema in `dashboard/src/lib/server/db.ts`. Keep the two in sync.
 *
 * Privacy: `ipHash` is SHA-256(IP + IP_HASH_SALT) — never the raw IP (UK GDPR).
 */
const verificationSchema = new Schema(
  {
    discordId: { type: String, required: true, index: true },
    guildId: { type: String, required: true },
    /** Discord handle at verify time (for the "already in as X" message). */
    username: { type: String, required: true },
    /** global_name at verify time. */
    displayName: { type: String, required: true },
    /** SHA-256(IP + IP_HASH_SALT) — never the raw IP. */
    ipHash: { type: String, required: true },
    /** When this ipHash was last seen for this user (recency filter, §8.1). */
    ipLastSeenAt: { type: Date, required: true, default: Date.now },
    fraudScore: { type: Number, required: true, default: 0 },
    /** Raw provider verdicts (no IP). */
    provider: {
      type: new Schema(
        {
          proxycheck: { type: Schema.Types.Mixed },
          ipinfo: { type: Schema.Types.Mixed },
        },
        { _id: false },
      ),
      default: {},
    },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { collection: "verifications" },
);

// One successful verification per user per guild (upsert target).
verificationSchema.index({ discordId: 1, guildId: 1 }, { unique: true });
// Multi-account (same-IP alt) lookup.
verificationSchema.index({ guildId: 1, ipHash: 1 });

export type VerificationDoc = InferSchemaType<typeof verificationSchema>;

export const Verification: Model<VerificationDoc> =
  (mongoose.models.Verification as Model<VerificationDoc> | undefined) ??
  mongoose.model<VerificationDoc>("Verification", verificationSchema);
