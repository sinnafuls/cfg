import { describe, it, expect, afterEach } from "vitest";
import type { RequestEvent } from "@sveltejs/kit";
import { getClientIp, redactIp, isPrivateIp } from "./ip.js";

/** Minimal RequestEvent stub: a header map + a getClientAddress() result. */
function mockEvent(opts: {
  headers?: Record<string, string>;
  address?: string;
}): RequestEvent {
  const entries = Object.entries(opts.headers ?? {}).map(
    ([k, v]) => [k.toLowerCase(), v] as const,
  );
  const map = new Map(entries);
  return {
    request: { headers: { get: (k: string) => map.get(k.toLowerCase()) ?? null } },
    getClientAddress: () => opts.address ?? "",
  } as unknown as RequestEvent;
}

describe("getClientIp", () => {
  afterEach(() => {
    delete process.env.CLIENT_IP_HEADER;
  });

  it("uses getClientAddress when no CLIENT_IP_HEADER is configured", () => {
    const ev = mockEvent({
      headers: { "cf-connecting-ip": "86.9.92.242" },
      address: "172.68.229.5",
    });
    expect(getClientIp(ev)).toBe("172.68.229.5");
  });

  it("reads CF-Connecting-IP when CLIENT_IP_HEADER is set (Cloudflare deploy)", () => {
    process.env.CLIENT_IP_HEADER = "cf-connecting-ip";
    const ev = mockEvent({
      headers: { "cf-connecting-ip": "86.9.92.242" },
      address: "172.68.229.5", // Cloudflare edge — must NOT be used
    });
    expect(getClientIp(ev)).toBe("86.9.92.242");
  });

  it("is case-insensitive on the header name", () => {
    process.env.CLIENT_IP_HEADER = "CF-Connecting-IP";
    const ev = mockEvent({ headers: { "cf-connecting-ip": "1.2.3.4" } });
    expect(getClientIp(ev)).toBe("1.2.3.4");
  });

  it("takes the first IP if the header carries a list", () => {
    process.env.CLIENT_IP_HEADER = "x-real-client";
    const ev = mockEvent({ headers: { "x-real-client": "9.9.9.9, 10.0.0.1" } });
    expect(getClientIp(ev)).toBe("9.9.9.9");
  });

  it("falls back to getClientAddress when the configured header is absent", () => {
    process.env.CLIENT_IP_HEADER = "cf-connecting-ip";
    const ev = mockEvent({ address: "203.0.113.7" });
    expect(getClientIp(ev)).toBe("203.0.113.7");
  });
});

describe("redactIp", () => {
  it("keeps the /24 and masks the host for IPv4", () => {
    expect(redactIp("86.9.92.242")).toBe("86.9.92.x");
  });
  it("shortens IPv6 to the first two hextets", () => {
    expect(redactIp("2a00:23c6:1234:5600:abcd::1")).toBe("2a00:23c6:…");
  });
  it("returns 'unknown' for empty or malformed input", () => {
    expect(redactIp("")).toBe("unknown");
    expect(redactIp("notanip")).toBe("unknown");
  });
});

describe("isPrivateIp", () => {
  it("flags loopback and RFC1918 ranges", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("10.1.2.3")).toBe(true);
    expect(isPrivateIp("192.168.0.5")).toBe(true);
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("100.64.0.1")).toBe(true); // CGNAT
  });
  it("does not flag a public address", () => {
    expect(isPrivateIp("86.9.92.242")).toBe(false);
    expect(isPrivateIp("172.68.229.5")).toBe(false); // Cloudflare edge is public
  });
});
