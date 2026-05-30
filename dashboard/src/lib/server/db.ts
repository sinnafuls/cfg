import mongoose from "mongoose";
import { env } from "$env/dynamic/private";

// Env lookup is deferred - `svelte-kit build` evaluates every server
// module during route analysis without the runtime env in scope, and any
// module-level throw would crash the build. ensureMongoConnection validates
// on first actual use.
function getMongoUri(): string {
  const uri = env.MONGODB_URI;
  if (!uri)
    throw new Error("MONGODB_URI must be set in the CFG web environment");
  return uri;
}

let connecting: Promise<typeof mongoose> | null = null;

/**
 * Lazily-initialised mongoose connection. SvelteKit may spin up multiple
 * requests in parallel on cold start; gate them on a single promise so we
 * only call `mongoose.connect` once.
 */
export async function ensureMongoConnection(): Promise<void> {
  if (mongoose.connection.readyState === 1) return;
  if (connecting) {
    await connecting;
    return;
  }
  connecting = mongoose.connect(getMongoUri(), {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 10,
    minPoolSize: 1,
    appName: "cfg-web",
    compressors: "zstd",
  });
  try {
    await connecting;
  } finally {
    connecting = null;
  }
}

/**
 * SvelteKit's devalue serializer rejects non-POJO leaves (Mongoose
 * `ObjectId`, sub-doc `Buffer`s) - a `.lean()` result still has those unless
 * you project them away. JSON round-trip is the cheap, total sanitizer:
 * ObjectId.toJSON emits hex strings, Date.toJSON emits ISO strings,
 * everything else becomes a plain object/array.
 *
 * Side effect: `Date` arrives at the page as a string, not a Date instance.
 * Use `new Date(v)` at the render site if you need methods.
 */
export function toPojo<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ── Models ───────────────────────────────────────────────────────────────
// Unlike perceptor's dashboard (which only READS bot-written docs via loose
// strict:false schemas), the CFG web is the sole WRITER of these two
// collections, so we declare STRICT, fully-typed schemas here. The bot owns
// the canonical copies in source/models/*; these MUST stay byte-for-byte
// equivalent in field names + index definitions.
//
// !!! keep in sync with source/models/Verification.ts !!!
// !!! keep in sync with source/models/VerificationBlock.ts !!!

/** Reason a verification attempt was blocked (durable audit + Redis block). */
export type BlockReason =
  | "vpn"
  | "proxy"
  | "datacenter"
  | "tor"
  | "fraud_score"
  | "both_apis_failed"
  | "multi_account";

export interface VerificationDoc {
  discordId: string;
  guildId: string;
  username: string;
  displayName: string;
  ipHash: string;
  ipLastSeenAt: Date;
  fraudScore: number;
  provider: { proxycheck?: unknown; ipinfo?: unknown };
  createdAt: Date;
}

export interface VerificationBlockDoc {
  discordId: string;
  guildId: string;
  reason: BlockReason;
  ipHash: string;
  fraudScore?: number;
  linkedDiscordId?: string;
  linkedDisplayName?: string;
  createdAt: Date;
  expiresAt: Date;
}

// One successful verification per user per guild (audit + de-dupe + alt
// detection). Unique compound key {discordId, guildId}; secondary
// {guildId, ipHash} for the same-IP multi-account lookup (§8.1).
const verificationSchema = new mongoose.Schema<VerificationDoc>(
  {
    discordId: { type: String, required: true, index: true },
    guildId: { type: String, required: true },
    username: { type: String, required: true },
    displayName: { type: String, required: true },
    ipHash: { type: String, required: true },
    ipLastSeenAt: { type: Date, required: true, default: Date.now },
    fraudScore: { type: Number, required: true, default: 0 },
    // Raw provider verdicts (no IP) kept for audit. Mixed: provider JSON
    // shapes vary and we never query into them.
    provider: {
      proxycheck: { type: mongoose.Schema.Types.Mixed },
      ipinfo: { type: mongoose.Schema.Types.Mixed },
    },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { collection: "verifications" },
);
verificationSchema.index({ discordId: 1, guildId: 1 }, { unique: true });
verificationSchema.index({ guildId: 1, ipHash: 1 });

// Durable block history (outlives the Redis cfg:block:<id> key; powers
// appeals/audit). Compound index for "most recent block for this user".
const verificationBlockSchema = new mongoose.Schema<VerificationBlockDoc>(
  {
    discordId: { type: String, required: true },
    guildId: { type: String, required: true },
    reason: { type: String, required: true },
    ipHash: { type: String, required: true },
    fraudScore: { type: Number },
    linkedDiscordId: { type: String },
    linkedDisplayName: { type: String },
    createdAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  { collection: "verificationblocks" },
);
verificationBlockSchema.index({ discordId: 1, guildId: 1, createdAt: -1 });

export const Verification: mongoose.Model<VerificationDoc> =
  (mongoose.models.Verification as mongoose.Model<VerificationDoc>) ??
  mongoose.model<VerificationDoc>("Verification", verificationSchema);

export const VerificationBlock: mongoose.Model<VerificationBlockDoc> =
  (mongoose.models.VerificationBlock as mongoose.Model<VerificationBlockDoc>) ??
  mongoose.model<VerificationBlockDoc>(
    "VerificationBlock",
    verificationBlockSchema,
  );
