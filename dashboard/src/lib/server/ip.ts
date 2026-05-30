import { createHash } from "node:crypto";
import { env } from "$env/dynamic/private";
import type { RequestEvent } from "@sveltejs/kit";

/**
 * Extract the real client IP for the current request. The right source depends
 * on the proxy chain in front of the app:
 *
 *   - Plain nginx only (one hop): adapter-node's getClientAddress() honours
 *     ADDRESS_HEADER=X-Forwarded-For + XFF_DEPTH=1 and returns the real client.
 *
 *   - Behind Cloudflare (Cloudflare -> nginx -> app, TWO hops): X-Forwarded-For's
 *     trusted tail is Cloudflare's EDGE IP, not the visitor, so depth-1 XFF
 *     yields a Cloudflare address (AS13335). Cloudflare puts the true visitor in
 *     the `CF-Connecting-IP` header instead. Set CLIENT_IP_HEADER=cf-connecting-ip
 *     and we read the visitor straight off that header.
 *
 * CLIENT_IP_HEADER, when set, is authoritative and read directly off the request.
 * If it's configured but missing on a given request (e.g. traffic that didn't
 * come through Cloudflare), we fall back to getClientAddress() rather than fail.
 *
 * Security note: only trust CLIENT_IP_HEADER when the app is reachable solely via
 * the proxy that sets it. cfg-web is on the internal/proxiable Docker network
 * (no public port), and Cloudflare is the only public entry, so the header can't
 * be forged by a direct client. For defence in depth, restrict nginx to
 * Cloudflare's IP ranges (or use nginx's real_ip module).
 */
export function getClientIp(event: RequestEvent): string {
  const headerName = env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (headerName) {
    const raw = event.request.headers.get(headerName);
    // CF-Connecting-IP is a single IP; split-on-comma is just defensive.
    const first = raw?.split(",")[0]?.trim();
    if (first) return first;
  }
  return event.getClientAddress();
}

// Env lookup deferred so `svelte-kit build` (which evaluates server modules
// without runtime env) doesn't crash. hashIp() validates the salt on first
// use.
function ipHashSalt(): string {
  const salt = env.IP_HASH_SALT;
  if (!salt || salt.length < 8) {
    throw new Error(
      "IP_HASH_SALT must be set and >= 8 chars (run `openssl rand -hex 32`)",
    );
  }
  return salt;
}

/**
 * Salted SHA-256 of a client IP. We NEVER persist or log the raw IP - it is
 * UK-GDPR personal data. Same salt → same hash for the same IP, which is what
 * lets the multi-account check equality-match alts without ever storing the
 * address. The salt is process-wide and secret; without it the hashes are not
 * reversible by dictionary attack on the (small) IPv4 space.
 */
export function hashIp(ip: string): string {
  return createHash("sha256")
    .update(ip + ipHashSalt())
    .digest("hex");
}

/**
 * Redact an IP for the staff log channel: keep enough to recognise a range /
 * ISP, drop the host portion. IPv4 `a.b.c.d` -> `a.b.c.x` (keeps the /24);
 * IPv6 -> first two hextets + `…`. Display-only; never stored (the durable
 * record keeps only the salted hash).
 */
export function redactIp(ip: string): string {
  if (!ip) return "unknown";
  if (ip.includes(":")) {
    const groups = ip.split(":").filter(Boolean);
    return `${groups.slice(0, 2).join(":")}:…`;
  }
  const octets = ip.split(".");
  if (octets.length === 4) return `${octets[0]}.${octets[1]}.${octets[2]}.x`;
  return "unknown";
}

/**
 * True for loopback / RFC1918 private / link-local / CGNAT addresses. In
 * production these indicate the reverse-proxy chain wasn't configured (we got
 * the proxy's own address, not the real client), so the callback should treat
 * such IPs as an error rather than silently verifying everyone behind the
 * proxy from one shared "IP".
 */
export function isPrivateIp(ip: string): boolean {
  if (!ip) return true;
  // IPv6 loopback / unspecified / unique-local / link-local.
  if (ip === "::1" || ip === "::") return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return true; // fc00::/7 unique-local
  if (/^fe80:/i.test(ip)) return true; // link-local
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) - strip and re-test as IPv4.
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  const v4 = mapped ? mapped[1]! : ip;

  const parts = v4.split(".");
  if (parts.length !== 4) return false; // not IPv4; non-private IPv6 handled above
  const [a, b] = parts.map((p) => Number(p)) as [number, number, ...number[]];
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  return false;
}
