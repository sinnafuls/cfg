import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { env } from "$env/dynamic/private";

// Env lookup is deferred - `svelte-kit build` evaluates server modules during
// route analysis without runtime env in scope, so a module-load throw crashes
// the build. sign/verify call stateSecret() lazily. Mirrors perceptor's
// session.ts signSession/readSession HMAC pattern.
function stateSecret(): string {
  const s = env.DASHBOARD_SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "DASHBOARD_SESSION_SECRET must be set and >= 16 chars (run `openssl rand -hex 32`)",
    );
  }
  return s;
}

/**
 * The OAuth `state` payload. `token` carries the verify token through the
 * Discord round-trip tamper-proof; `nonce` is double-submitted via the
 * __Host-cfg_oauth cookie for CSRF protection (the callback asserts the
 * signed-state nonce equals the cookie nonce).
 */
export interface VerifyState {
  token: string;
  nonce: string;
}

/** Generate a fresh CSRF nonce for a single OAuth start. */
export function newNonce(): string {
  return randomBytes(16).toString("base64url");
}

/** HMAC-sign a state payload into a `<body>.<sig>` string for the URL. */
export function signVerifyState(payload: VerifyState): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", stateSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

/**
 * Verify a signed state string and return its payload, or null if the
 * signature is missing/invalid or the body is malformed. Constant-time
 * comparison guards against signature-timing oracles.
 */
export function readVerifyState(state: string | undefined): VerifyState | null {
  if (!state) return null;
  const dot = state.indexOf(".");
  if (dot <= 0) return null;
  const body = state.slice(0, dot);
  const sig = state.slice(dot + 1);

  const expected = createHmac("sha256", stateSecret())
    .update(body)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString(),
    ) as Partial<VerifyState>;
    if (typeof payload.token !== "string" || typeof payload.nonce !== "string")
      return null;
    return { token: payload.token, nonce: payload.nonce };
  } catch {
    return null;
  }
}

/**
 * Name of the short-lived CSRF nonce cookie set at OAuth start.
 *
 * The `__Host-` prefix is a browser-enforced hardening: it REQUIRES the
 * cookie be Secure, Path=/, and have no Domain - exactly the posture we want
 * in production. But Secure cookies aren't stored over plain http://localhost,
 * which would break local dev, so we fall back to the un-prefixed name (and
 * Secure=false) in dev. Callers must set the cookie's `secure` flag to match:
 * true with the prefix, false without.
 */
export function oauthNonceCookieName(isProd: boolean): string {
  return isProd ? "__Host-cfg_oauth" : "cfg_oauth";
}
