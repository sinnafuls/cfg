import { Discord } from "arctic";
import { env } from "$env/dynamic/private";

// Env lookup deferred - `svelte-kit build` evaluates server modules during
// route analysis without runtime env, so module-load throws would crash the
// build. discordFor() validates per-request.
function discordCreds(): { id: string; secret: string } {
  const id = env.DISCORD_CLIENT_ID;
  const secret = env.DISCORD_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      "DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET must be set in the CFG web environment",
    );
  }
  return { id, secret };
}

/**
 * Build a Discord OAuth client whose redirect URI is derived from the actual
 * incoming request's origin. This lets local dev
 * (`http://localhost:5173/auth/callback`) and the production deploy
 * (`https://cfg.ly.ax/auth/callback`) both work without flipping any env var
 * - Discord allows multiple redirect URIs per application, so register both
 * in the Dev Portal once and forget.
 *
 * Arctic's `Discord` class stores the redirect URI on construction and sends
 * it in both the auth-URL generation AND the token-exchange POST; the two
 * MUST match, so we build a fresh client per request rather than mutating a
 * singleton.
 */
export function discordFor(requestUrl: URL): Discord {
  const { id, secret } = discordCreds();
  return new Discord(id, secret, `${requestUrl.origin}/auth/callback`);
}

// CFG only needs to prove the clicker owns the Discord ID bound to the token.
// `identify` returns id/username/global_name from /users/@me - no `guilds`
// scope required (membership/role checks ride the Redis bus).
export const OAUTH_SCOPES = ["identify"] as const;
