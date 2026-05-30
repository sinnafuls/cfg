import { env } from "$env/dynamic/private";
import { Verification, type VerificationDoc } from "./db.js";
import { sendCheckMembership } from "./redis.js";

// ── Config ─────────────────────────────────────────────────────────────────

export type MultiAccountMode = "block" | "flag" | "off";

export interface MultiAccountConfig {
  mode: MultiAccountMode;
  maxPerIp: number;
  ipWindowDays: number;
  /** Connection types that front many distinct people (mobile/corp/edu) → flag. */
  lenientConnTypes: string[];
}

export function multiAccountConfigFromEnv(): MultiAccountConfig {
  const mode =
    env.MULTI_ACCOUNT_MODE === "flag"
      ? "flag"
      : env.MULTI_ACCOUNT_MODE === "off"
        ? "off"
        : "block";
  const maxPerIp = Number(env.MULTI_ACCOUNT_MAX_PER_IP);
  const ipWindowDays = Number(env.MULTI_ACCOUNT_IP_WINDOW_DAYS);
  const lenientConnTypes = (env.MULTI_ACCOUNT_LENIENT_CONN_TYPES ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return {
    mode,
    maxPerIp: Number.isFinite(maxPerIp) && maxPerIp >= 1 ? maxPerIp : 1,
    ipWindowDays: Number.isFinite(ipWindowDays) ? ipWindowDays : 90,
    lenientConnTypes:
      lenientConnTypes.length > 0
        ? lenientConnTypes
        : ["mobile", "corporate", "education"],
  };
}

// ── Result ───────────────────────────────────────────────────────────────

export interface MultiAccountResult {
  conflict: boolean;
  /** Effective mode after leniency downgrade ("block" may become "flag"). */
  mode: MultiAccountMode;
  linkedDiscordId?: string;
  linkedDisplayName?: string;
}

/**
 * A candidate alt: an existing Verification confirmed to still be a live guild
 * member, with its current display name. The pure core works on these so it
 * needs no DB/bus access.
 */
export interface LiveCandidate {
  discordId: string;
  displayName: string;
  /** ipLastSeenAt epoch ms - oldest live member is named in the message. */
  ipLastSeenMs: number;
}

/**
 * PURE multi-account decision. Given the live candidates (already
 * recency-filtered and membership-confirmed) and the effective mode, decide
 * whether the new account conflicts and which existing account to name.
 *
 * Conflict when the number of distinct live members on this IP is already at
 * or above maxPerIp (the NEW account would push it over). The OLDEST live
 * member (smallest ipLastSeenMs) is named - it's the established account.
 */
export function decideMultiAccount(
  liveCandidates: LiveCandidate[],
  mode: MultiAccountMode,
  maxPerIp: number,
): MultiAccountResult {
  if (mode === "off" || liveCandidates.length < maxPerIp) {
    return { conflict: false, mode };
  }
  // Adding this account exceeds the per-IP allowance.
  const oldest = [...liveCandidates].sort(
    (a, b) => a.ipLastSeenMs - b.ipLastSeenMs,
  )[0]!;
  return {
    conflict: true,
    mode,
    linkedDiscordId: oldest.discordId,
    linkedDisplayName: oldest.displayName,
  };
}

// ── Injectable dependencies (real impls used in prod, mocked in tests) ─────

export interface MultiAccountDeps {
  /** Find other verifications in this guild sharing the ipHash. */
  findCandidates: (
    guildId: string,
    ipHash: string,
    excludeDiscordId: string,
  ) => Promise<Pick<VerificationDoc, "discordId" | "ipLastSeenAt">[]>;
  /** Confirm liveness + fetch current display name via the bot bus. */
  checkMembership: (
    discordId: string,
    guildId: string,
  ) => Promise<{ inGuild: boolean; displayName?: string }>;
  /** Injectable clock for the recency window (defaults to Date.now). */
  now?: () => number;
}

const defaultDeps: MultiAccountDeps = {
  async findCandidates(guildId, ipHash, excludeDiscordId) {
    return Verification.find(
      { guildId, ipHash, discordId: { $ne: excludeDiscordId } },
      { discordId: 1, ipLastSeenAt: 1 },
    ).lean();
  },
  async checkMembership(discordId, guildId) {
    const res = await sendCheckMembership(discordId, guildId);
    if (!res.ok || !res.data) return { inGuild: false };
    return { inGuild: res.data.inGuild, displayName: res.data.displayName };
  },
};

export interface CheckMultiAccountArgs {
  ipHash: string;
  discordId: string;
  guildId: string;
  /** Connection-type hint for the CURRENT request (drives leniency). */
  connType?: string;
  cfg: MultiAccountConfig;
}

/**
 * Orchestrate the §8.1 same-IP alt check. Runs ONLY on a CLEAN (non-VPN) IP -
 * the caller enforces precedence. Steps:
 *   1. find other accounts in this guild that verified from this ipHash;
 *   2. drop matches older than ipWindowDays (IP churn);
 *   3. if the current connType is shared-NAT (mobile/corp/edu) → downgrade a
 *      block to a flag (those IPs legitimately front many people);
 *   4. confirm each candidate is still a live member via the bus, capturing
 *      its live display name; drop those who left;
 *   5. delegate the count/conflict decision to the pure core.
 *
 * `deps` is injected so unit tests can mock the DB + bus without I/O.
 */
export async function checkMultiAccount(
  args: CheckMultiAccountArgs,
  deps: MultiAccountDeps = defaultDeps,
): Promise<MultiAccountResult> {
  const { ipHash, discordId, guildId, connType, cfg } = args;
  if (cfg.mode === "off") return { conflict: false, mode: "off" };

  const now = deps.now ? deps.now() : Date.now();

  // 1. Candidate alts sharing this exact salted-IP hash.
  const raw = await deps.findCandidates(guildId, ipHash, discordId);

  // 2. Recency filter - stale IP matches are probably a different household.
  const windowMs = cfg.ipWindowDays * 24 * 60 * 60 * 1000;
  const recent = raw.filter((c) => {
    const seen = new Date(c.ipLastSeenAt).getTime();
    return Number.isFinite(seen) && now - seen <= windowMs;
  });

  // 3. Shared-NAT leniency: a connection type that fronts many people
  //    downgrades a hard block into a soft flag.
  const lenient =
    !!connType &&
    cfg.lenientConnTypes.includes(connType.toLowerCase());
  const effectiveMode: MultiAccountMode =
    lenient && cfg.mode === "block" ? "flag" : cfg.mode;

  // 4. Liveness + live name via the bot bus. Drop candidates who left.
  const liveCandidates: LiveCandidate[] = [];
  for (const c of recent) {
    const m = await deps.checkMembership(c.discordId, guildId);
    if (m.inGuild) {
      liveCandidates.push({
        discordId: c.discordId,
        displayName: m.displayName ?? c.discordId,
        ipLastSeenMs: new Date(c.ipLastSeenAt).getTime(),
      });
    }
  }

  // 5. Pure count/conflict decision.
  return decideMultiAccount(liveCandidates, effectiveMode, cfg.maxPerIp);
}
