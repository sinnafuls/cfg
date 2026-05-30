import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

/**
 * VerificationBlock — durable block history.
 *
 * Outlives the ephemeral Redis `cfg:block:<id>` key and powers appeals / audit.
 * Written by the web side when a verification is flagged (VPN/proxy) or a
 * multi-account conflict is detected.
 *
 * Canonical schema lives here in the bot; the dashboard re-declares a matching
 * strict schema in `dashboard/src/lib/server/db.ts`. Keep the two in sync.
 */
const BLOCK_REASONS = [
  "vpn",
  "proxy",
  "datacenter",
  "tor",
  "fraud_score",
  "both_apis_failed",
  "multi_account",
] as const;

export type VerificationBlockReason = (typeof BLOCK_REASONS)[number];

const verificationBlockSchema = new Schema(
  {
    discordId: { type: String, required: true },
    guildId: { type: String, required: true },
    reason: { type: String, required: true, enum: BLOCK_REASONS },
    ipHash: { type: String, required: true },
    fraudScore: { type: Number },
    /** multi_account: the existing account already in the guild. */
    linkedDiscordId: { type: String },
    /** multi_account: name shown to the blocked user. */
    linkedDisplayName: { type: String },
    createdAt: { type: Date, required: true, default: Date.now },
    /** vpn: +24h. multi_account: +MULTI_ACCOUNT_BLOCK_TTL. */
    expiresAt: { type: Date, required: true },
  },
  { collection: "verificationblocks" },
);

verificationBlockSchema.index({ discordId: 1, guildId: 1, createdAt: -1 });

export type VerificationBlockDoc = InferSchemaType<
  typeof verificationBlockSchema
>;

export const VerificationBlock: Model<VerificationBlockDoc> =
  (mongoose.models.VerificationBlock as
    | Model<VerificationBlockDoc>
    | undefined) ??
  mongoose.model<VerificationBlockDoc>(
    "VerificationBlock",
    verificationBlockSchema,
  );
