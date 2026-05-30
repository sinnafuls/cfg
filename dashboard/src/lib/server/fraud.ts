import { env } from "$env/dynamic/private";
import type { BlockReason } from "./db.js";

/**
 * Fraud / VPN / proxy / datacenter detection.
 *
 * Two providers are queried in parallel (Promise.allSettled) so one outage
 * doesn't sink the other:
 *   - ProxyCheck.io  — PRIMARY VPN/proxy/Tor detector. Returns a `proxy`
 *                      yes/no flag, a connection `type` (VPN, Tor, SOCKS,
 *                      Hosting, Residential, ...), and a `risk` score (0-100).
 *   - ipinfo Lite    — SECONDARY datacenter detector. The free Lite tier has
 *                      no privacy/VPN flags, so we infer datacenter membership
 *                      from the autonomous-system identity (`as_name` /
 *                      `as_domain`). It also feeds a coarse connection-type hint
 *                      used by multi-account leniency.
 *
 * (IPQualityScore was removed — it no longer offers a free tier.)
 *
 * `decide()` is pure (no I/O, no env, no clock) so it is exhaustively
 * unit-testable. Its `reason` values stay within the shared `BlockReason`
 * enum so the bot's block-message handler and the Mongo audit schema need no
 * changes when the provider mix changes.
 */

// ── Provider verdict shapes (normalised) ───────────────────────────────────
// Only the fields the decision needs; the full response is kept verbatim in
// `raw` and stored in Verification.provider for audit.

export interface ProxycheckVerdict {
  /** Normalised from the v2 "yes"/"no" string. */
  proxy: boolean;
  /** e.g. "VPN" | "Tor" | "SOCKS" | "Hosting" | "Residential" | "". */
  type: string;
  provider: string;
  /** ProxyCheck risk score 0-100 (risk=1); 0 when unavailable. */
  risk: number;
  raw?: unknown;
}

export interface IpinfoVerdict {
  asn: string; // e.g. "AS15169"
  asName: string; // e.g. "Google LLC"
  asDomain: string; // e.g. "google.com"
  countryCode: string;
  /** Derived from as_name/as_domain — ipinfo Lite has no privacy flags. */
  isDatacenter: boolean;
  raw?: unknown;
}

export interface FraudChecks {
  proxycheck?: ProxycheckVerdict;
  ipinfo?: IpinfoVerdict;
  /** Both provider calls failed (rejected or non-OK) — drives FAIL_MODE. */
  bothFailed: boolean;
}

export type FailMode = "open" | "closed";

export interface DecideConfig {
  /** ProxyCheck risk score at/above which we flag (0-100). */
  riskThreshold: number;
  /** Flag IPs whose ASN looks like a hosting/datacenter network (ipinfo). */
  blockDatacenter: boolean;
  failMode: FailMode;
}

export interface Decision {
  flagged: boolean;
  /** Block reason when flagged; undefined when clean. Stays within BlockReason. */
  reason?: BlockReason;
}

// Map a ProxyCheck connection `type` to a BlockReason. Anything proxy-like
// that isn't VPN/Tor/Hosting is bucketed as a generic "proxy".
const PROXYCHECK_TYPE_REASON: Record<string, BlockReason> = {
  VPN: "vpn",
  Tor: "tor",
  Hosting: "datacenter",
  SOCKS: "proxy",
  SOCKS4: "proxy",
  SOCKS5: "proxy",
  HTTP: "proxy",
  HTTPS: "proxy",
  "Web Proxy": "proxy",
  "Public Proxy": "proxy",
  "Compromised Server": "proxy",
};

// AS-name / AS-domain substrings that indicate a hosting/datacenter/cloud
// network rather than a residential ISP. ipinfo Lite exposes no privacy flags,
// so we infer datacenter membership from the autonomous-system identity. Keep
// this reasonably high-precision to avoid locking out residential ISPs; it can
// be disabled with IPINFO_BLOCK_DATACENTER=false.
const DATACENTER_KEYWORDS = [
  "hosting",
  "datacenter",
  "data center",
  "colocation",
  "cloud",
  "vps",
  "dedicated server",
  "amazon",
  "aws",
  "google llc",
  "google cloud",
  "azure",
  "microsoft",
  "digitalocean",
  "ovh",
  "hetzner",
  "linode",
  "akamai",
  "leaseweb",
  "m247",
  "choopa",
  "vultr",
  "contabo",
  "scaleway",
  "oracle cloud",
  "alibaba",
  "tencent cloud",
];

export function looksLikeDatacenter(asName: string, asDomain: string): boolean {
  const hay = `${asName} ${asDomain}`.toLowerCase();
  return DATACENTER_KEYWORDS.some((kw) => hay.includes(kw));
}

// AS-name substrings that indicate a mobile carrier — used to derive a
// connection-type hint for multi-account leniency (mobile/CGNAT pools front
// many distinct people behind one IP).
const MOBILE_KEYWORDS = [
  "mobile",
  "wireless",
  "cellular",
  "t-mobile",
  "vodafone",
  "verizon wireless",
  "at&t mobility",
  "telefonica",
  "lte",
  "gsm",
];

/**
 * Coarse connection-type hint for multi-account leniency. ipinfo Lite has no
 * connection_type field, so we infer one from ProxyCheck's `type` first, then
 * from the ipinfo AS name/domain. Returns "" (residential/unknown) when no
 * confident hint is available.
 */
export function deriveConnType(
  proxycheck: ProxycheckVerdict | undefined,
  ipinfo: IpinfoVerdict | undefined,
): string {
  const pcType = (proxycheck?.type ?? "").toLowerCase();
  if (pcType.includes("wireless") || pcType.includes("mobile")) return "mobile";
  if (pcType.includes("education")) return "education";
  if (pcType.includes("business") || pcType.includes("corporate"))
    return "corporate";

  const asName = (ipinfo?.asName ?? "").toLowerCase();
  const asDomain = (ipinfo?.asDomain ?? "").toLowerCase();
  if (MOBILE_KEYWORDS.some((k) => asName.includes(k))) return "mobile";
  if (
    asDomain.endsWith(".edu") ||
    asDomain.endsWith(".ac.uk") ||
    asName.includes("university") ||
    asName.includes("college")
  ) {
    return "education";
  }
  return "";
}

/**
 * PURE VPN/proxy decision. No I/O, no env, no clock — fully unit-testable.
 *
 * Precedence is deliberate and important:
 *
 *  1. ProxyCheck is AUTHORITATIVE when present. It has real data on whether an
 *     IP is a proxy / VPN / Tor / hosting node, so a CLEAN ProxyCheck verdict
 *     means the user is clean — full stop. We do NOT let the crude ipinfo
 *     ASN-name heuristic override it. (ipinfo Lite has no proxy/hosting flag at
 *     all; `isDatacenter` is only a guess from the AS company name, which
 *     produced false positives for residential ISPs — e.g. a Virgin Media
 *     cable line flagged as "datacenter" while ProxyCheck said Residential.)
 *
 *  2. Only when ProxyCheck is UNAVAILABLE do we fall back to the weak ipinfo
 *     datacenter heuristic, as a best-effort backstop during a ProxyCheck
 *     outage.
 *
 *  3. If NEITHER provider returned a verdict, honour failMode: "open" passes
 *     the user (logged as both_apis_failed for review) so an outage doesn't
 *     lock out legit users; "closed" blocks.
 */
export function decide(
  proxycheck: ProxycheckVerdict | undefined,
  ipinfo: IpinfoVerdict | undefined,
  cfg: DecideConfig,
): Decision {
  // 1. ProxyCheck present → it decides, and a clean result is final.
  if (proxycheck) {
    const mapped = PROXYCHECK_TYPE_REASON[proxycheck.type];
    if (mapped) return { flagged: true, reason: mapped };
    if (proxycheck.proxy) return { flagged: true, reason: "proxy" };
    if (proxycheck.risk >= cfg.riskThreshold)
      return { flagged: true, reason: "fraud_score" };
    // ProxyCheck says clean — trust it; do not consult the ipinfo guess.
    return { flagged: false };
  }

  // 2. ProxyCheck unavailable → weak ipinfo ASN backstop.
  if (ipinfo) {
    if (cfg.blockDatacenter && ipinfo.isDatacenter) {
      return { flagged: true, reason: "datacenter" };
    }
    return { flagged: false };
  }

  // 3. Neither provider available → fail policy.
  return cfg.failMode === "closed"
    ? { flagged: true, reason: "both_apis_failed" }
    : { flagged: false, reason: "both_apis_failed" };
}

// ── Provider fetchers (the only I/O in this module) ────────────────────────
// Each throws on a network/non-OK/API error so runFraudChecks' allSettled
// records it as `undefined` and decide() applies the fail-mode policy.

interface ProxycheckRaw {
  status?: string;
  [ip: string]:
    | { proxy?: string; type?: string; provider?: string; risk?: number }
    | string
    | undefined;
}

export async function fetchProxycheck(ip: string): Promise<ProxycheckVerdict> {
  // ProxyCheck works keyless at a low rate; the key just lifts limits.
  const key = env.PROXYCHECK_API_KEY ?? "";
  const qs = new URLSearchParams({ vpn: "1", asn: "1", risk: "1" });
  if (key) qs.set("key", key);
  const url = `https://proxycheck.io/v2/${encodeURIComponent(ip)}?${qs.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ProxyCheck HTTP ${res.status}`);
  const data = (await res.json()) as ProxycheckRaw;
  if (data.status && data.status !== "ok")
    throw new Error(`ProxyCheck status ${data.status}`);
  const entry = data[ip];
  if (!entry || typeof entry === "string")
    throw new Error("ProxyCheck: no entry for IP");
  return {
    proxy: entry.proxy === "yes",
    type: typeof entry.type === "string" ? entry.type : "",
    provider: typeof entry.provider === "string" ? entry.provider : "",
    risk: typeof entry.risk === "number" ? entry.risk : 0,
    raw: data,
  };
}

interface IpinfoRaw {
  error?: unknown;
  asn?: string;
  as_name?: string;
  as_domain?: string;
  country_code?: string;
}

export async function fetchIpinfo(ip: string): Promise<IpinfoVerdict> {
  const token = env.IPINFO_TOKEN;
  if (!token) throw new Error("IPINFO_TOKEN not set");
  const url = `https://api.ipinfo.io/lite/${encodeURIComponent(ip)}?token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ipinfo HTTP ${res.status}`);
  const data = (await res.json()) as IpinfoRaw;
  if (data.error) throw new Error("ipinfo returned an error");
  const asName = typeof data.as_name === "string" ? data.as_name : "";
  const asDomain = typeof data.as_domain === "string" ? data.as_domain : "";
  return {
    asn: typeof data.asn === "string" ? data.asn : "",
    asName,
    asDomain,
    countryCode: typeof data.country_code === "string" ? data.country_code : "",
    isDatacenter: looksLikeDatacenter(asName, asDomain),
    raw: data,
  };
}

/**
 * Run both providers concurrently. A provider that throws or returns a non-OK
 * response contributes `undefined`; if BOTH are undefined we set `bothFailed`
 * so decide() can apply the fail-mode policy.
 */
export async function runFraudChecks(ip: string): Promise<FraudChecks> {
  const [proxycheckResult, ipinfoResult] = await Promise.allSettled([
    fetchProxycheck(ip),
    fetchIpinfo(ip),
  ]);

  const proxycheck =
    proxycheckResult.status === "fulfilled" ? proxycheckResult.value : undefined;
  const ipinfo =
    ipinfoResult.status === "fulfilled" ? ipinfoResult.value : undefined;

  return { proxycheck, ipinfo, bothFailed: !proxycheck && !ipinfo };
}

/** Resolve decide() config from env (deferred; not used by decide() itself). */
export function decideConfigFromEnv(): DecideConfig {
  const threshold = Number(env.PROXYCHECK_RISK_THRESHOLD);
  return {
    riskThreshold: Number.isFinite(threshold) ? threshold : 75,
    blockDatacenter: env.IPINFO_BLOCK_DATACENTER !== "false",
    failMode: env.FAIL_MODE === "closed" ? "closed" : "open",
  };
}
