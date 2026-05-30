# Discord VPN-Verification Bot — Implementation Spec

## Overview
A Discord verification system. New members get a button to request a one-time
verification link. The link opens an Astro site, authenticates them via Discord
OAuth (proving the link is theirs), checks their IP against IPQualityScore +
ProxyCheck, and either assigns a verified role or blocks them for 24 hours if a
VPN/proxy/datacenter IP is detected.

## Tech Stack
- **Bot:** TypeScript, discord.js v14
- **Frontend/verification server:** Astro (SSR mode, Node adapter)
- **Database:** MongoDB via Mongoose (NoSQL; document model fits the token/block/verification records well, easy TTL-based expiry)
- **Shared:** monorepo with pnpm workspaces — `packages/bot`, `packages/web`, `packages/shared` (shared types + Mongoose models + DB connection)

## Architecture / Flow
```
User joins guild
  └─> Bot posts (or already-present) "Verify" embed with a button
       └─> User clicks button (interaction)
            └─> Bot generates a one-time token, stores {token, discordId, guildId, expiresAt}
                 └─> Bot replies EPHEMERALLY with link: https://verify.example.com/v/<token>
                      └─> User opens link
                           └─> Astro checks token validity (exists, unused, not expired)
                                └─> Redirect to Discord OAuth (identify scope)
                                     └─> OAuth callback: confirm OAuth'd user === token's discordId
                                          └─> Capture client IP, run IPQS + ProxyCheck
                                               ├─> CLEAN: call bot/internal API -> assign role -> success page
                                               └─> FLAGGED: record 24h block -> blocked page
```

## Data Model (Mongoose)

Use MongoDB TTL indexes so expired tokens and blocks clean themselves up
automatically (no cron needed).

```typescript
// VerificationToken
{
  token:     string;   // unique, indexed
  discordId: string;
  guildId:   string;
  used:      boolean;  // default false
  createdAt: Date;     // default now
  expiresAt: Date;     // now + 15 min — TTL index on this field
}
// TTL index: schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

// Block
{
  discordId: string;
  guildId:   string;
  reason:    string;   // "vpn" | "proxy" | "datacenter" | "tor"
  ipHash:    string;   // SHA-256(IP + salt) — never store raw IP (GDPR)
  createdAt: Date;     // default now
  expiresAt: Date;     // createdAt + 24h — TTL index on this field
}
// Compound index: { discordId: 1, guildId: 1 }
// TTL index: { expiresAt: 1 }, expireAfterSeconds: 0

// Verification
{
  discordId:  string;
  guildId:    string;
  ipHash:     string;
  fraudScore: number;
  createdAt:  Date;    // default now
}
// Unique compound index: { discordId: 1, guildId: 1 }
```

> **Note on TTL semantics:** MongoDB's TTL monitor runs roughly every 60s, so
> expiry is *approximately* on time, not instant. Always also check `expiresAt`
> in application logic (don't rely on the TTL sweep alone for security
> decisions). The TTL index is for cleanup, the in-code check is for correctness.

## Components to Build

### 1. `packages/bot` (discord.js)
- **Client setup** with intents: `Guilds`, `GuildMembers`. Slash command registration.
- **DB connection** on startup via the shared package (`connectMongo()`).
- **Slash command `/setup-verify`** (admin only): posts the persistent verification embed with a button (`customId: "request_verify"`) into the current channel.
- **Button interaction handler** for `request_verify`:
  1. Check if user already has the verified role → reply ephemeral "already verified".
  2. Query `Block` collection for an active block (`expiresAt > now`) → reply ephemeral "you're blocked until <time>".
  3. Generate token (`crypto.randomUUID()` or `nanoid`), insert `VerificationToken` with 15-min expiry.
  4. Reply **ephemerally** with the link `${WEB_BASE_URL}/v/${token}`.
- **Internal HTTP endpoint OR shared role-assignment function.** Cleanest approach: the bot exposes a tiny authenticated internal API (Fastify/Express) that the Astro server calls to assign the role, so role logic stays in the bot process which holds the gateway connection. Secure it with a shared secret header (`X-Internal-Secret`).
  - `POST /internal/assign-role` `{ discordId, guildId }` → adds role.
- **(Optional) `guildMemberAdd` listener** to auto-post a welcome/verify prompt or DM, if you don't rely solely on the static embed.

### 2. `packages/web` (Astro, SSR)
- **`/v/[token].astro`** (server-rendered):
  - Look up token. If missing/used/expired → render an "invalid or expired link" page.
  - Put the token into the OAuth `state` parameter (and optionally a short-lived signed cookie), then redirect to the Discord OAuth authorize URL with `scope=identify` and `state=<token>`.
- **`/api/oauth/callback.ts`** (Astro endpoint):
  1. Exchange `code` for access token, fetch `/users/@me`.
  2. Verify returned Discord user ID matches the token's `discordId`. Mismatch → reject.
  3. Re-validate token (still unused, not expired) in code.
  4. **Capture IP** — read from the proxy header your host sets. If behind Cloudflare use `CF-Connecting-IP`; behind a generic reverse proxy use the leftmost untrusted entry of `X-Forwarded-For`. Make the trusted-proxy config explicit so it can't be spoofed.
  5. Run **both** checks in parallel (`Promise.allSettled`):
     - IPQS: `https://ipqualityscore.com/api/json/ip/<KEY>/<IP>` → read `proxy`, `vpn`, `tor`, `fraud_score`, connection type.
     - ProxyCheck: `https://proxycheck.io/v2/<IP>?key=<KEY>&vpn=1&asn=1` → read `proxy`, `type` (VPN/hosting/etc), `provider`.
  6. **Decision logic** (configurable thresholds): flag if `IPQS.proxy || IPQS.vpn || IPQS.tor || IPQS.fraud_score >= THRESHOLD` **OR** `ProxyCheck.proxy === "yes" || type ∈ {VPN, Tor, Hosting/Datacenter}`. Use OR for safety, but make the fraud_score threshold tunable (start ~85).
  7. Mark token `used = true`.
  8. **CLEAN** → call bot internal API to assign role, upsert `Verification` doc, redirect to `/result?status=success`.
  9. **FLAGGED** → insert `Block` doc (24h expiry, store `ipHash` = SHA-256 of IP + server-side salt), redirect to `/result?status=blocked&until=<ts>`.
- **`/result.astro`**: renders success or blocked state nicely.
- **Block recheck:** the bot already checks the `Block` collection before issuing a new link, so a blocked user simply can't get a fresh link for 24h.

### 3. `packages/shared`
- Mongoose connection singleton (`connectMongo()` — reuse the connection across hot reloads in Astro dev).
- Mongoose models (`VerificationToken`, `Block`, `Verification`) with the indexes above.
- Shared TS types (`VerificationResult`) and the decision-logic helper function (pure, unit-testable).
- Env validation (zod).

## Security & Privacy Notes
- **Never store raw IPs.** Hash with SHA-256 + a secret salt before persisting. IPs are personal data under UK GDPR.
- **Token = one-time, short-lived (15 min), single-use.** Bind to the requesting Discord ID and verify via OAuth so users can't share/forge links.
- **OAuth `state`** must carry/verify the token to prevent CSRF and link-swapping.
- **Internal bot API** must require a shared secret and ideally bind to localhost / private network only.
- **Rate limit** the `/v/[token]` and OAuth callback routes.
- **Privacy notice** on the landing page: state that the IP is checked for VPN/proxy and not stored in raw form.
- **Handle API failures gracefully:** with `Promise.allSettled`, if one provider errors use the other; if *both* error, decide a policy. Recommended: fail-open + flag for manual review + log, to avoid locking out legitimate users during an API outage. Make this configurable (`FAIL_MODE=open|closed`).
- **MongoDB connection string** should use auth + TLS in production; never commit it.

## Environment Variables
```
DISCORD_BOT_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_GUILD_ID=          # or multi-guild config
VERIFIED_ROLE_ID=
OAUTH_REDIRECT_URI=https://verify.example.com/api/oauth/callback
WEB_BASE_URL=https://verify.example.com
IPQS_API_KEY=
PROXYCHECK_API_KEY=
INTERNAL_API_SECRET=
IP_HASH_SALT=
FRAUD_SCORE_THRESHOLD=85
FAIL_MODE=open             # open | closed — behaviour when both IP APIs fail
MONGODB_URI=mongodb://localhost:27017/discord-verify
```

## Suggested Build Order
1. Monorepo (pnpm workspaces) + shared package: Mongoose connection, models with TTL/compound indexes, zod env validation.
2. Bot: client, DB connect, `/setup-verify`, button handler, token generation, ephemeral reply.
3. Bot internal role-assign API (secret-protected).
4. Astro: token landing page + Discord OAuth flow (token in `state`).
5. Astro: IP capture + IPQS/ProxyCheck integration (`Promise.allSettled`) + decision logic.
6. Wire CLEAN path → role assignment + `Verification` upsert; FLAGGED path → `Block` insert.
7. Result pages, block-recheck in bot, rate limiting, privacy notice.
8. Error handling, logging, fail-open/closed policy.

## Notes / Gotchas
- The OAuth step proves the link belongs to the clicking user (link-binding); the **IP check** is what actually enforces the no-VPN rule.
- Residential-IP detection is never 100%. Mobile carriers and CGNAT can cause false positives. Consider a manual-override / appeals path and tune `FRAUD_SCORE_THRESHOLD` rather than relying on a pure binary block.
- In Astro dev mode, guard the Mongoose connection against repeated hot-reload connects (cache the connection on `globalThis`).
