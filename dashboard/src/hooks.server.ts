import type { Handle } from "@sveltejs/kit";
import { dev } from "$app/environment";
import { rateLimit } from "$lib/server/redis.js";

// Fixed-window rate limit applied to the two abusable surfaces: the token
// landing (/v/*) and the OAuth callback. 10 requests / 5 minutes per IP is
// generous for a human verifying once but throttles enumeration / replay.
const RL_LIMIT = 10;
const RL_WINDOW_SEC = 5 * 60;

function isRateLimited(pathname: string): boolean {
  return pathname.startsWith("/v/") || pathname === "/auth/callback";
}

export const handle: Handle = async ({ event, resolve }) => {
  // ── Rate limit (fail-open) ──────────────────────────────────────────────
  if (isRateLimited(event.url.pathname)) {
    // getClientAddress() honours ADDRESS_HEADER/XFF_DEPTH behind the proxy.
    const ip = event.getClientAddress();
    const { allowed } = await rateLimit(
      `req:${event.url.pathname.startsWith("/v/") ? "v" : "cb"}:${ip}`,
      RL_LIMIT,
      RL_WINDOW_SEC,
    );
    if (!allowed) {
      return new Response("Too many requests. Please slow down.", {
        status: 429,
        headers: { "Retry-After": String(RL_WINDOW_SEC) },
      });
    }
  }

  const response = await resolve(event);

  // ── Security headers ────────────────────────────────────────────────────
  // CSP: self-hosted assets only; Discord CDN allowed for avatars/icons in
  // case a future view renders them. SvelteKit hydration needs 'unsafe-inline'
  // for its bootstrap script/style unless we wire up per-request nonces, which
  // is overkill for a tiny no-input verification flow.
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://cdn.discordapp.com",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self' https://discord.com",
    ].join("; "),
  );
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // HSTS only in prod (https) - sending it over http://localhost would pin the
  // browser to https for localhost and break dev.
  if (!dev) {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }

  return response;
};
