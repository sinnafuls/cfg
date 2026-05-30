import { describe, it, expect, vi, afterEach } from "vitest";
import {
  checkMultiAccount,
  decideMultiAccount,
  multiAccountConfigFromEnv,
  type MultiAccountConfig,
  type MultiAccountDeps,
  type LiveCandidate,
} from "./multiAccount.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000; // fixed clock for deterministic recency math

function cfg(over: Partial<MultiAccountConfig> = {}): MultiAccountConfig {
  return {
    mode: "block",
    maxPerIp: 1,
    ipWindowDays: 90,
    lenientConnTypes: ["mobile", "corporate", "education"],
    ...over,
  };
}

/** Build injectable deps with a fixed clock + scripted DB + bus responses. */
function makeDeps(
  candidates: { discordId: string; ipLastSeenMs: number }[],
  membership: Record<string, { inGuild: boolean; displayName?: string }>,
): MultiAccountDeps {
  return {
    now: () => NOW,
    findCandidates: vi.fn(async () =>
      candidates.map((c) => ({
        discordId: c.discordId,
        ipLastSeenAt: new Date(c.ipLastSeenMs),
      })),
    ),
    checkMembership: vi.fn(
      async (discordId: string) =>
        membership[discordId] ?? { inGuild: false },
    ),
  };
}

describe("decideMultiAccount() (pure core)", () => {
  const live = (id: string, ms: number): LiveCandidate => ({
    discordId: id,
    displayName: `name-${id}`,
    ipLastSeenMs: ms,
  });

  it("no conflict when below maxPerIp", () => {
    expect(decideMultiAccount([], "block", 1)).toEqual({
      conflict: false,
      mode: "block",
    });
  });

  it("conflict at maxPerIp, names the OLDEST live member", () => {
    const r = decideMultiAccount(
      [live("new-er", NOW), live("oldest", NOW - 10 * DAY)],
      "block",
      1,
    );
    expect(r.conflict).toBe(true);
    expect(r.linkedDiscordId).toBe("oldest");
    expect(r.linkedDisplayName).toBe("name-oldest");
  });

  it("mode off never conflicts", () => {
    expect(
      decideMultiAccount([live("a", NOW), live("b", NOW)], "off", 1).conflict,
    ).toBe(false);
  });

  it("respects maxPerIp > 1", () => {
    // Two existing live members allowed; a third (this account) triggers it.
    expect(
      decideMultiAccount([live("a", NOW), live("b", NOW)], "block", 2).conflict,
    ).toBe(true);
    expect(
      decideMultiAccount([live("a", NOW)], "block", 2).conflict,
    ).toBe(false);
  });
});

describe("checkMultiAccount() (orchestrator)", () => {
  const base = {
    ipHash: "hash",
    discordId: "current",
    guildId: "guild",
    connType: "Residential",
  };

  it("conflict on a shared recent IP with a live member", async () => {
    const deps = makeDeps([{ discordId: "alt", ipLastSeenMs: NOW - DAY }], {
      alt: { inGuild: true, displayName: "AltUser" },
    });
    const r = await checkMultiAccount({ ...base, cfg: cfg() }, deps);
    expect(r.conflict).toBe(true);
    expect(r.linkedDiscordId).toBe("alt");
    expect(r.linkedDisplayName).toBe("AltUser");
  });

  it("no conflict when the only match is stale (> window)", async () => {
    const deps = makeDeps(
      [{ discordId: "alt", ipLastSeenMs: NOW - 100 * DAY }], // > 90d
      { alt: { inGuild: true, displayName: "AltUser" } },
    );
    const r = await checkMultiAccount({ ...base, cfg: cfg() }, deps);
    expect(r.conflict).toBe(false);
    // Stale candidate is filtered before the bus call - never checked.
    expect(deps.checkMembership).not.toHaveBeenCalled();
  });

  it("no hard block when the linked account has left the guild", async () => {
    const deps = makeDeps([{ discordId: "alt", ipLastSeenMs: NOW - DAY }], {
      alt: { inGuild: false },
    });
    const r = await checkMultiAccount({ ...base, cfg: cfg() }, deps);
    expect(r.conflict).toBe(false);
  });

  it("downgrades block→flag on a lenient (mobile) connection type", async () => {
    const deps = makeDeps([{ discordId: "alt", ipLastSeenMs: NOW - DAY }], {
      alt: { inGuild: true, displayName: "AltUser" },
    });
    const r = await checkMultiAccount(
      { ...base, connType: "Mobile", cfg: cfg() },
      deps,
    );
    // Still a conflict, but the mode is now "flag" so the caller assigns the
    // role and alerts staff instead of hard-blocking.
    expect(r.conflict).toBe(true);
    expect(r.mode).toBe("flag");
  });

  it("respects maxPerIp before flagging a conflict", async () => {
    const deps = makeDeps(
      [
        { discordId: "alt1", ipLastSeenMs: NOW - DAY },
        { discordId: "alt2", ipLastSeenMs: NOW - 2 * DAY },
      ],
      {
        alt1: { inGuild: true, displayName: "Alt1" },
        alt2: { inGuild: true, displayName: "Alt2" },
      },
    );
    // maxPerIp=2 allows two existing live members; the current account makes 3.
    const r = await checkMultiAccount(
      { ...base, cfg: cfg({ maxPerIp: 2 }) },
      deps,
    );
    expect(r.conflict).toBe(true);
    // Oldest live member named.
    expect(r.linkedDiscordId).toBe("alt2");
  });

  it("mode off short-circuits without touching the DB", async () => {
    const deps = makeDeps([], {});
    const r = await checkMultiAccount(
      { ...base, cfg: cfg({ mode: "off" }) },
      deps,
    );
    expect(r).toEqual({ conflict: false, mode: "off" });
    expect(deps.findCandidates).not.toHaveBeenCalled();
  });

  it("filters a candidate with an unparseable ipLastSeenAt", async () => {
    const deps: MultiAccountDeps = {
      now: () => NOW,
      findCandidates: vi.fn(async () => [
        { discordId: "bad", ipLastSeenAt: new Date(NaN) },
      ]),
      checkMembership: vi.fn(async () => ({ inGuild: true })),
    };
    const r = await checkMultiAccount({ ...base, cfg: cfg() }, deps);
    expect(r.conflict).toBe(false);
    expect(deps.checkMembership).not.toHaveBeenCalled();
  });

  it("uses the candidate's discordId as the name when the bus omits one", async () => {
    const deps = makeDeps([{ discordId: "alt", ipLastSeenMs: NOW - DAY }], {
      alt: { inGuild: true }, // no displayName returned
    });
    const r = await checkMultiAccount({ ...base, cfg: cfg() }, deps);
    expect(r.conflict).toBe(true);
    expect(r.linkedDisplayName).toBe("alt");
  });
});

describe("multiAccountConfigFromEnv()", () => {
  afterEach(() => {
    delete process.env.MULTI_ACCOUNT_MODE;
    delete process.env.MULTI_ACCOUNT_MAX_PER_IP;
    delete process.env.MULTI_ACCOUNT_IP_WINDOW_DAYS;
    delete process.env.MULTI_ACCOUNT_LENIENT_CONN_TYPES;
  });

  it("defaults: block / maxPerIp 1 / window 90 / mobile,corporate,education", () => {
    expect(multiAccountConfigFromEnv()).toEqual({
      mode: "block",
      maxPerIp: 1,
      ipWindowDays: 90,
      lenientConnTypes: ["mobile", "corporate", "education"],
    });
  });

  it("reads mode flag + custom knobs from env", () => {
    process.env.MULTI_ACCOUNT_MODE = "flag";
    process.env.MULTI_ACCOUNT_MAX_PER_IP = "3";
    process.env.MULTI_ACCOUNT_IP_WINDOW_DAYS = "30";
    process.env.MULTI_ACCOUNT_LENIENT_CONN_TYPES = "Mobile, Corporate";
    expect(multiAccountConfigFromEnv()).toEqual({
      mode: "flag",
      maxPerIp: 3,
      ipWindowDays: 30,
      lenientConnTypes: ["mobile", "corporate"],
    });
  });

  it("reads mode off", () => {
    process.env.MULTI_ACCOUNT_MODE = "off";
    expect(multiAccountConfigFromEnv().mode).toBe("off");
  });

  it("clamps an invalid maxPerIp back to 1", () => {
    process.env.MULTI_ACCOUNT_MAX_PER_IP = "0";
    expect(multiAccountConfigFromEnv().maxPerIp).toBe(1);
  });
});
