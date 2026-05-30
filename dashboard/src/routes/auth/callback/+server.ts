import { error, redirect } from "@sveltejs/kit";
import { dev } from "$app/environment";
import { env } from "$env/dynamic/private";
import { discordFor } from "$lib/server/auth.js";
import {
  readVerifyState,
  oauthNonceCookieName,
} from "$lib/server/verifyState.js";
import {
  getToken,
  consumeToken,
  setBlock,
  publishVerifyAction,
  publishLogEvent,
} from "$lib/server/redis.js";
import { getClientIp, hashIp, isPrivateIp } from "$lib/server/ip.js";
import {
  runFraudChecks,
  decide,
  decideConfigFromEnv,
  deriveConnType,
} from "$lib/server/fraud.js";
import {
  checkMultiAccount,
  multiAccountConfigFromEnv,
} from "$lib/server/multiAccount.js";
import {
  ensureMongoConnection,
  Verification,
  VerificationBlock,
} from "$lib/server/db.js";
import type { RequestHandler } from "./$types.js";

interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
}

const BLOCK_TTL_SECONDS = 24 * 60 * 60; // 24h for a VPN/proxy block

export const GET: RequestHandler = async (event) => {
  const { url, cookies } = event;
  const code = url.searchParams.get("code");
  const rawState = url.searchParams.get("state") ?? undefined;

  // 1. Verify the signed state + double-submitted nonce cookie.
  const state = readVerifyState(rawState);
  const cookieName = oauthNonceCookieName(!dev);
  const cookieNonce = cookies.get(cookieName);
  cookies.delete(cookieName, { path: "/" });
  if (!code || !state || !cookieNonce || cookieNonce !== state.nonce) {
    error(400, "Verification request expired or invalid. Please start again.");
  }

  // 2. Exchange the code and fetch the Discord identity.
  const discord = discordFor(url);
  let accessToken: string;
  try {
    const tokens = await discord.validateAuthorizationCode(code);
    accessToken = tokens.accessToken();
  } catch {
    error(400, "Discord rejected the sign-in. Please start again.");
  }

  const meRes = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!meRes.ok) error(502, "Failed to fetch your Discord identity.");
  const me = (await meRes.json()) as DiscordUser;

  // 3. Read the token (NOT consuming yet) to learn which Discord ID it was
  //    issued to, and assert the signed-in account matches. Asserting before
  //    consuming means a user who fat-fingers the wrong Discord account
  //    doesn't burn their one-time link.
  const peek = await getToken(state.token).catch(() => null);
  if (!peek) {
    error(400, "This verification link was already used or has expired.");
  }
  if (me.id !== peek.discordId) {
    error(
      403,
      "This link was issued to a different Discord account. Sign in with the account that requested verification.",
    );
  }

  // 4. Atomically consume the token (single-use; redis GETDEL). Two concurrent
  //    callbacks racing the same token: only one wins, the other gets null and
  //    is rejected here.
  const tokenPayload = await consumeToken(state.token).catch(() => null);
  if (!tokenPayload || tokenPayload.discordId !== me.id) {
    error(400, "This verification link was already used or has expired.");
  }

  const { discordId, guildId } = tokenPayload;
  const username = me.username;
  const displayName = me.global_name ?? me.username;

  // 5. Capture + hash the client IP. Never persist the raw IP.
  const ip = getClientIp(event);
  if (!ip || (!dev && isPrivateIp(ip))) {
    // In prod a private/loopback IP means the proxy chain isn't forwarding the
    // real client address - fail to an error state rather than verifying
    // everyone behind the proxy as one shared "IP".
    await publishLogEvent(discordId, guildId, {
      outcome: "error",
      username,
      reason: "could not read a public client IP (proxy misconfigured?)",
    });
    redirect(303, "/result?status=error");
  }
  const ipHash = hashIp(ip);

  // 6. Run the fraud providers concurrently.
  const checks = await runFraudChecks(ip).catch(() => ({
    proxycheck: undefined,
    ipinfo: undefined,
    bothFailed: true,
  }));

  // 7. Pure VPN/proxy decision.
  const fraudCfg = decideConfigFromEnv();
  const decision = decide(checks.proxycheck, checks.ipinfo, fraudCfg);

  await ensureMongoConnection();

  // ── FLAGGED (VPN/proxy/tor/datacenter/fraud_score/both_apis_failed) ──────
  if (decision.flagged) {
    const reason = decision.reason ?? "fraud_score";
    const now = Date.now();
    const until = now + BLOCK_TTL_SECONDS * 1000;
    await setBlock(
      discordId,
      { reason, until },
      BLOCK_TTL_SECONDS,
    ).catch(() => {});
    await VerificationBlock.create({
      discordId,
      guildId,
      reason,
      ipHash,
      fraudScore: checks.proxycheck?.risk,
      createdAt: new Date(now),
      expiresAt: new Date(until),
    }).catch(() => {});
    await publishLogEvent(discordId, guildId, {
      outcome: "blocked",
      username,
      reason,
      risk: checks.proxycheck?.risk,
      connType: deriveConnType(checks.proxycheck, checks.ipinfo) || undefined,
      country: checks.ipinfo?.countryCode || undefined,
      until,
    });
    redirect(303, `/result?status=blocked&until=${until}`);
  }

  // 8. Multi-account (same-IP alt) check — only on a CLEAN IP.
  const maCfg = multiAccountConfigFromEnv();
  const ma =
    maCfg.mode === "off"
      ? { conflict: false as const }
      : await checkMultiAccount({
          ipHash,
          discordId,
          guildId,
          connType: deriveConnType(checks.proxycheck, checks.ipinfo),
          cfg: maCfg,
        }).catch(() => ({ conflict: false as const }));

  // ── DUPLICATE (multi-account, effective mode "block") ────────────────────
  if (ma.conflict && "mode" in ma && ma.mode === "block") {
    const now = Date.now();
    const ttl = Number(env.MULTI_ACCOUNT_BLOCK_TTL) || BLOCK_TTL_SECONDS;
    const until = now + ttl * 1000;
    await VerificationBlock.create({
      discordId,
      guildId,
      reason: "multi_account",
      ipHash,
      linkedDiscordId: ma.linkedDiscordId,
      linkedDisplayName: ma.linkedDisplayName,
      createdAt: new Date(now),
      expiresAt: new Date(until),
    }).catch(() => {});
    await setBlock(
      discordId,
      {
        reason: "multi_account",
        until,
        linkedDisplayName: ma.linkedDisplayName,
      },
      ttl,
    ).catch(() => {});
    await publishLogEvent(discordId, guildId, {
      outcome: "duplicate",
      username,
      reason: "multi_account",
      linkedDiscordId: ma.linkedDiscordId,
      linkedDisplayName: ma.linkedDisplayName,
      country: checks.ipinfo?.countryCode || undefined,
    });
    const as = encodeURIComponent(ma.linkedDisplayName ?? "");
    redirect(303, `/result?status=duplicate&as=${as}`);
  }

  // ── CLEAN (passed VPN and multi-account) ─────────────────────────────────
  // "flag" mode falls through to here: the account is assigned the role but a
  // staff alert is logged (server-side) so moderators can review the soft
  // multi-account hit. "off" mode also lands here (ma.conflict === false).
  if (ma.conflict && "mode" in ma && ma.mode === "flag") {
    console.warn(
      `[multi-account] FLAG: ${discordId} shares an IP with ${ma.linkedDiscordId} (${ma.linkedDisplayName}) in guild ${guildId} — role assigned, please review.`,
    );
  }

  await Verification.updateOne(
    { discordId, guildId },
    {
      $set: {
        username,
        displayName,
        ipHash,
        ipLastSeenAt: new Date(),
        fraudScore: checks.proxycheck?.risk ?? 0,
        provider: {
          proxycheck: checks.proxycheck?.raw,
          ipinfo: checks.ipinfo?.raw,
        },
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  ).catch(() => {});

  // Assign the verified role over the bus and poll for confirmation. On
  // timeout we still treat the user as verified (soft-state) - the bot
  // reconciles on reconnect - so a Redis/bot hiccup doesn't show an error to
  // an otherwise-clean user.
  const assign = await publishVerifyAction(discordId, guildId).catch(() => ({
    ok: false,
  }));

  // Log the clean verification (note in the feed if the role is still syncing
  // or if this passed under a soft multi-account flag).
  const flagged = ma.conflict && "mode" in ma && ma.mode === "flag";
  await publishLogEvent(discordId, guildId, {
    outcome: "verified",
    username,
    risk: checks.proxycheck?.risk,
    connType: deriveConnType(checks.proxycheck, checks.ipinfo) || undefined,
    country: checks.ipinfo?.countryCode || undefined,
    reason: flagged
      ? `multi-account soft-flag (shares IP with ${ma.linkedDisplayName ?? ma.linkedDiscordId})`
      : assign.ok
        ? undefined
        : "role assignment pending (bot/redis slow)",
  });

  if (!assign.ok) {
    redirect(303, "/result?status=success&pending=1");
  }
  redirect(303, "/result?status=success");
};
