import { error, redirect } from "@sveltejs/kit";
import { dev } from "$app/environment";
import { discordFor, OAUTH_SCOPES } from "$lib/server/auth.js";
import { getToken } from "$lib/server/redis.js";
import {
  newNonce,
  signVerifyState,
  oauthNonceCookieName,
} from "$lib/server/verifyState.js";
import type { RequestHandler } from "./$types.js";

/**
 * OAuth start. Reached from the "Verify with Discord" button on the landing
 * page. We:
 *   1. re-validate the token exists (it could have expired while the user read
 *      the privacy notice) - do NOT consume it; the callback consumes it;
 *   2. mint a CSRF nonce, sign {token, nonce} into the OAuth `state` (HMAC, so
 *      Discord can't tamper with which token we resume), and double-submit the
 *      nonce via a short-lived host-prefixed cookie;
 *   3. redirect to Discord's consent screen with the `identify` scope only.
 */
export const GET: RequestHandler = async ({ params, url, cookies }) => {
  const payload = await getToken(params.token).catch(() => null);
  if (!payload) {
    // Bounce to the landing page, which will render the "invalid/expired" UI.
    redirect(303, `/v/${params.token}`);
  }

  const nonce = newNonce();
  const state = signVerifyState({ token: params.token, nonce });

  const discord = discordFor(url);
  let authUrl: URL;
  try {
    authUrl = discord.createAuthorizationURL(state, [...OAUTH_SCOPES]);
  } catch {
    error(500, "OAuth is not configured. Contact server staff.");
  }

  cookies.set(oauthNonceCookieName(!dev), nonce, {
    path: "/",
    httpOnly: true,
    // __Host- prefix requires Secure; we only use the prefix in prod (see
    // oauthNonceCookieName), and dev runs over http so Secure must be off.
    secure: !dev,
    sameSite: "lax",
    maxAge: 600, // 10 min - covers the consent round-trip
  });

  redirect(302, authUrl.toString());
};
