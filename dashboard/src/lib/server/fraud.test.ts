import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  decide,
  deriveConnType,
  looksLikeDatacenter,
  runFraudChecks,
  fetchProxycheck,
  fetchIpinfo,
  decideConfigFromEnv,
  type ProxycheckVerdict,
  type IpinfoVerdict,
  type DecideConfig,
} from "./fraud.js";

const cfg = (over: Partial<DecideConfig> = {}): DecideConfig => ({
  riskThreshold: 75,
  blockDatacenter: true,
  failMode: "open",
  ...over,
});

const pc = (over: Partial<ProxycheckVerdict> = {}): ProxycheckVerdict => ({
  proxy: false,
  type: "Residential",
  provider: "Comcast",
  risk: 0,
  ...over,
});

const info = (over: Partial<IpinfoVerdict> = {}): IpinfoVerdict => ({
  asn: "AS7922",
  asName: "Comcast Cable",
  asDomain: "comcast.net",
  countryCode: "US",
  isDatacenter: false,
  ...over,
});

describe("decide()", () => {
  it("passes a clean residential IP", () => {
    expect(decide(pc(), info(), cfg())).toEqual({ flagged: false });
  });

  it("flags ProxyCheck type VPN as vpn", () => {
    expect(decide(pc({ proxy: true, type: "VPN" }), undefined, cfg())).toEqual({
      flagged: true,
      reason: "vpn",
    });
  });

  it("flags ProxyCheck type Tor as tor", () => {
    expect(decide(pc({ proxy: true, type: "Tor" }), undefined, cfg())).toEqual({
      flagged: true,
      reason: "tor",
    });
  });

  it("flags ProxyCheck type Hosting as datacenter", () => {
    expect(
      decide(pc({ proxy: false, type: "Hosting" }), undefined, cfg()),
    ).toEqual({ flagged: true, reason: "datacenter" });
  });

  it("maps SOCKS/Web Proxy types to a generic proxy reason", () => {
    expect(decide(pc({ proxy: true, type: "SOCKS5" }), undefined, cfg()).reason).toBe(
      "proxy",
    );
    expect(
      decide(pc({ proxy: true, type: "Web Proxy" }), undefined, cfg()).reason,
    ).toBe("proxy");
  });

  it("flags proxy=true with an unmapped type as proxy", () => {
    expect(
      decide(pc({ proxy: true, type: "Unknown" }), undefined, cfg()),
    ).toEqual({ flagged: true, reason: "proxy" });
  });

  it("flags when risk score meets the threshold as fraud_score", () => {
    expect(decide(pc({ risk: 80 }), undefined, cfg())).toEqual({
      flagged: true,
      reason: "fraud_score",
    });
  });

  it("does not flag when risk is below the threshold", () => {
    expect(decide(pc({ risk: 70 }), undefined, cfg())).toEqual({
      flagged: false,
    });
  });

  it("respects a custom risk threshold", () => {
    expect(decide(pc({ risk: 60 }), undefined, cfg({ riskThreshold: 50 }))).toEqual(
      { flagged: true, reason: "fraud_score" },
    );
  });

  it("flags a datacenter ASN from ipinfo when proxycheck is clean", () => {
    expect(decide(pc(), info({ isDatacenter: true }), cfg())).toEqual({
      flagged: true,
      reason: "datacenter",
    });
  });

  it("does not flag datacenter when blockDatacenter is off", () => {
    expect(
      decide(pc(), info({ isDatacenter: true }), cfg({ blockDatacenter: false })),
    ).toEqual({ flagged: false });
  });

  it("ipinfo datacenter still flags when proxycheck is undefined", () => {
    expect(decide(undefined, info({ isDatacenter: true }), cfg()).reason).toBe(
      "datacenter",
    );
  });

  it("both providers failed + fail open -> pass, both_apis_failed", () => {
    expect(decide(undefined, undefined, cfg())).toEqual({
      flagged: false,
      reason: "both_apis_failed",
    });
  });

  it("both providers failed + fail closed -> flag, both_apis_failed", () => {
    expect(decide(undefined, undefined, cfg({ failMode: "closed" }))).toEqual({
      flagged: true,
      reason: "both_apis_failed",
    });
  });

  it("one provider failed, survivor (proxycheck) decides", () => {
    expect(decide(pc({ proxy: true, type: "VPN" }), undefined, cfg()).flagged).toBe(
      true,
    );
    expect(decide(pc(), undefined, cfg()).flagged).toBe(false);
  });
});

describe("looksLikeDatacenter()", () => {
  it("detects hosting/cloud AS names", () => {
    expect(looksLikeDatacenter("DigitalOcean, LLC", "digitalocean.com")).toBe(true);
    expect(looksLikeDatacenter("Amazon.com, Inc.", "amazon.com")).toBe(true);
    expect(looksLikeDatacenter("OVH SAS", "ovh.com")).toBe(true);
  });
  it("does not flag a residential ISP", () => {
    expect(looksLikeDatacenter("Comcast Cable", "comcast.net")).toBe(false);
    expect(looksLikeDatacenter("BT Group", "bt.com")).toBe(false);
  });
});

describe("deriveConnType()", () => {
  it("returns mobile from a ProxyCheck wireless type", () => {
    expect(deriveConnType(pc({ type: "Wireless" }), undefined)).toBe("mobile");
  });
  it("returns corporate from a ProxyCheck business type", () => {
    expect(deriveConnType(pc({ type: "Business" }), undefined)).toBe("corporate");
  });
  it("returns mobile from a carrier AS name", () => {
    expect(deriveConnType(undefined, info({ asName: "T-Mobile USA" }))).toBe(
      "mobile",
    );
  });
  it("returns education from a .edu AS domain", () => {
    expect(
      deriveConnType(
        undefined,
        info({ asName: "Example University", asDomain: "mit.edu" }),
      ),
    ).toBe("education");
  });
  it("returns empty for a plain residential IP", () => {
    expect(deriveConnType(pc(), info())).toBe("");
  });
});

describe("runFraudChecks()", () => {
  beforeEach(() => {
    process.env.PROXYCHECK_API_KEY = "test-pc";
    process.env.IPINFO_TOKEN = "test-ipinfo";
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.PROXYCHECK_API_KEY;
    delete process.env.IPINFO_TOKEN;
  });

  it("returns both verdicts when both providers succeed", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL) => {
        const u = String(input);
        if (u.includes("ipinfo.io")) {
          return new Response(
            JSON.stringify({
              ip: "1.2.3.4",
              asn: "AS7922",
              as_name: "Comcast Cable",
              as_domain: "comcast.net",
              country_code: "US",
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            status: "ok",
            "1.2.3.4": { proxy: "no", type: "Residential", provider: "Comcast", risk: 0 },
          }),
          { status: 200 },
        );
      },
    );
    const r = await runFraudChecks("1.2.3.4");
    expect(r.bothFailed).toBe(false);
    expect(r.proxycheck?.type).toBe("Residential");
    expect(r.ipinfo?.isDatacenter).toBe(false);
  });

  it("marks ipinfo as datacenter for a hosting ASN", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input: RequestInfo | URL) => {
        const u = String(input);
        if (u.includes("ipinfo.io")) {
          return new Response(
            JSON.stringify({
              ip: "1.2.3.4",
              asn: "AS14061",
              as_name: "DigitalOcean, LLC",
              as_domain: "digitalocean.com",
              country_code: "US",
            }),
            { status: 200 },
          );
        }
        return new Response("err", { status: 500 });
      },
    );
    const r = await runFraudChecks("1.2.3.4");
    expect(r.proxycheck).toBeUndefined();
    expect(r.ipinfo?.isDatacenter).toBe(true);
    expect(r.bothFailed).toBe(false);
  });

  it("sets bothFailed when both providers fail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("err", { status: 500 }),
    );
    const r = await runFraudChecks("1.2.3.4");
    expect(r.bothFailed).toBe(true);
    expect(r.proxycheck).toBeUndefined();
    expect(r.ipinfo).toBeUndefined();
  });
});

describe("fetchProxycheck()", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.PROXYCHECK_API_KEY;
  });

  it("throws on a non-OK HTTP status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 429 }),
    );
    await expect(fetchProxycheck("1.2.3.4")).rejects.toThrow("ProxyCheck HTTP 429");
  });

  it("throws when the API status is not ok", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "denied" }), { status: 200 }),
    );
    await expect(fetchProxycheck("1.2.3.4")).rejects.toThrow(
      "ProxyCheck status denied",
    );
  });

  it("throws when there is no entry for the IP", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
    );
    await expect(fetchProxycheck("1.2.3.4")).rejects.toThrow("no entry");
  });

  it("normalises a successful response and sends the key when present", async () => {
    process.env.PROXYCHECK_API_KEY = "pck";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "ok",
          "1.2.3.4": { proxy: "yes", type: "VPN", provider: "Mullvad", risk: 66 },
        }),
        { status: 200 },
      ),
    );
    const v = await fetchProxycheck("1.2.3.4");
    expect(v).toMatchObject({ proxy: true, type: "VPN", provider: "Mullvad", risk: 66 });
    expect(String(fetchMock.mock.calls[0]![0])).toContain("key=pck");
  });
});

describe("fetchIpinfo()", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.IPINFO_TOKEN;
  });

  it("throws without a token", async () => {
    delete process.env.IPINFO_TOKEN;
    await expect(fetchIpinfo("1.2.3.4")).rejects.toThrow("IPINFO_TOKEN not set");
  });

  it("throws on a non-OK HTTP status", async () => {
    process.env.IPINFO_TOKEN = "t";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 503 }),
    );
    await expect(fetchIpinfo("1.2.3.4")).rejects.toThrow("ipinfo HTTP 503");
  });

  it("throws when the API returns an error field", async () => {
    process.env.IPINFO_TOKEN = "t";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "wrong token" }), { status: 200 }),
    );
    await expect(fetchIpinfo("1.2.3.4")).rejects.toThrow("ipinfo returned an error");
  });

  it("normalises a successful response and derives datacenter", async () => {
    process.env.IPINFO_TOKEN = "t";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ip: "1.2.3.4",
          asn: "AS16509",
          as_name: "Amazon.com, Inc.",
          as_domain: "amazon.com",
          country_code: "US",
        }),
        { status: 200 },
      ),
    );
    const v = await fetchIpinfo("1.2.3.4");
    expect(v).toMatchObject({ asn: "AS16509", isDatacenter: true });
  });
});

describe("decideConfigFromEnv()", () => {
  afterEach(() => {
    delete process.env.PROXYCHECK_RISK_THRESHOLD;
    delete process.env.IPINFO_BLOCK_DATACENTER;
    delete process.env.FAIL_MODE;
  });

  it("defaults to threshold 75, datacenter on, fail open", () => {
    expect(decideConfigFromEnv()).toEqual({
      riskThreshold: 75,
      blockDatacenter: true,
      failMode: "open",
    });
  });

  it("reads overrides from env", () => {
    process.env.PROXYCHECK_RISK_THRESHOLD = "60";
    process.env.IPINFO_BLOCK_DATACENTER = "false";
    process.env.FAIL_MODE = "closed";
    expect(decideConfigFromEnv()).toEqual({
      riskThreshold: 60,
      blockDatacenter: false,
      failMode: "closed",
    });
  });
});
