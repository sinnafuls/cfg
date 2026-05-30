# CFG — Control Flow Guard

CFG is a Discord bot + web service that verifies new guild members are **not**
connecting through a VPN or proxy before granting them a verified role. It keeps
friction low for legitimate users and is self-hostable with Docker.

## How it works

1. A member joins the guild (or runs `/verify`). The bot sends them a unique,
   single-use verification link.
2. The member opens the link in their own browser — the CFG web service at
   `cfg.ly.ax`.
3. The web service reads the client IP (via the `X-Forwarded-For` header set by
   nginx), checks it against VPN/proxy detection APIs, and applies the
   multi-account policy.
4. If the connection is clean, the web service publishes a grant action over
   Redis; the bot grants the verified role and records the result. If it is
   blocked, the member sees a clear reason and can retry after disconnecting.

---

## Architecture

```
Discord ──► cfg-bot (discord.js) ──► MongoDB (guild config, verification records)
                  │                        ▲
                  │  Redis pub/sub          │
                  ▼  (cfg:verify-actions)   │
            cfg-web (SvelteKit) ───────────┘
                  │                  │
                  ▼                  ▼
            nginx (cfg.ly.ax)   VPN/proxy APIs (proxycheck, ipinfo)
```

- **cfg-bot** (`source/`) — discord.js v14, TypeScript, ESM. Handles
  `guildMemberAdd` and the `/verify` slash command, issues verification tokens,
  subscribes to `cfg:verify-actions` on Redis to grant roles, and persists guild
  config + verification records to MongoDB.
- **cfg-web** (`dashboard/`) — SvelteKit (adapter-node). Serves the verification
  page, performs VPN/proxy detection and the multi-account check, and publishes
  grant/deny actions to the bot over Redis.
- **cfg-redis** — pub/sub bridge + token / block storage.
  Keys: `cfg:token:<token>`, `cfg:block:<key>`; channel `cfg:verify-actions`.
- **MongoDB** — durable store for guild config and verification records
  (external; not in compose — supply `MONGODB_URI`).

---

## Setup

### 1. Configure environment

Bot and web share a single `.env` at the repo root. Start from `.env.example`:

```bash
cp .env.example .env
# then fill in the values below
```

#### Bot (`source/`)

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_BOT_TOKEN` | yes | Bot token from the Discord developer portal |
| `DISCORD_CLIENT_ID` | yes | Application client ID (slash command registration) |
| `GUILD_ID` | yes | Target guild ID |
| `VERIFIED_ROLE_ID` | no | Role to grant on successful verification. Bootstrap default — overridable at runtime with `/config set-role` |
| `LOG_CHANNEL_ID` | no | Channel for verification log embeds. Overridable with `/config set-channel`. Unset = logging off |
| `MONGODB_URI` | yes | MongoDB connection string |
| `REDIS_URL` | yes | Redis connection string (compose sets `redis://cfg-redis:6379`) |
| `WEB_BASE_URL` | yes | Public base URL of the web service (e.g. `https://cfg.ly.ax`) |
| `LOG_LEVEL` | no | Log level: `ERROR`/`WARN`/`INFO`/`DEBUG` (default `INFO`) |

#### Slash commands

All are gated to **Manage Server**.

| Command | What it does |
|---------|--------------|
| `/setup-verify [channel]` | Post the Verify panel (button) in a channel |
| `/config set-role <role>` | Set the role granted on a clean verification |
| `/config set-channel <channel>` | Set the channel that receives verification log embeds |
| `/config view` | Show the current role, log channel, and detection settings |
| `/admin unblock <user>` | Clear a member's block so they can verify again |
| `/admin view <user>` | Show a member's verified status, verification record, and recent block history |
| `/admin stats` | Verification metrics: verified totals (24h / 7d / all-time), active blocks, and blocks by reason |

#### Logging

If a log channel is set (`/config set-channel` or `LOG_CHANNEL_ID`), the bot posts a
colour-coded embed for every verification outcome:

- 🟢 **Verified** — who passed, connection type, country
- 🔴 **Blocked** — who, the reason (VPN / proxy / datacenter / Tor / risk), risk score, retry time
- 👥 **Alt blocked** — the new account and the existing account it's linked to
- 🟠 **Error** — verifications that failed partway (e.g. IP couldn't be read)

The web service decides outcomes, then asks the bot to post via the Redis action bus
(fire-and-forget — a logging hiccup never blocks a verification).

#### Web (`dashboard/`)

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_CLIENT_ID` | yes | OAuth app client ID (shared with bot) |
| `DISCORD_CLIENT_SECRET` | yes | OAuth app client secret |
| `DASHBOARD_SESSION_SECRET` | yes | Secret for signing session cookies |
| `PROXYCHECK_API_KEY` | no | proxycheck.io API key — primary VPN/proxy/Tor detector (free 1000/day) |
| `IPINFO_TOKEN` | no | ipinfo.io Lite API token — datacenter/ASN detection (free) |
| `PROXYCHECK_RISK_THRESHOLD` | no | ProxyCheck risk score 0-100 to flag on (default `75`) |
| `IPINFO_BLOCK_DATACENTER` | no | `true`/`false` — flag hosting/datacenter ASNs (default `true`) |
| `FAIL_MODE` | no | `open` (allow) or `closed` (block) when BOTH providers fail (default `open`) |
| `MULTI_ACCOUNT_MODE` | no | `block` / `flag` / `off` (default `block`) |
| `MULTI_ACCOUNT_MAX_PER_IP` | no | Distinct live members allowed per IP before blocking (default `1`) |
| `MULTI_ACCOUNT_IP_WINDOW_DAYS` | no | Ignore IP matches older than this (default `90`) |
| `MULTI_ACCOUNT_BLOCK_TTL` | no | Redis block TTL (seconds) for an alt hit (default `86400`) |
| `MULTI_ACCOUNT_LENIENT_CONN_TYPES` | no | Connection types downgraded block→flag (default `mobile,corporate,education`) |
| `MULTI_ACCOUNT_REVEAL_USERNAME` | no | `true` / `masked` / `false` — how much of the linked account's name to show (default `true`) |
| `IP_HASH_SALT` | yes | Salt for hashing IPs at rest |
| `MONGODB_URI` | yes | MongoDB connection string |
| `REDIS_URL` | yes | Redis connection string |
| `WEB_BASE_URL` | yes | Public base URL |

> Web env is read lazily via `$env/dynamic/private` (so `svelte-kit build` runs
> without runtime env). `IP_HASH_SALT`, `DISCORD_CLIENT_SECRET`, and
> `DASHBOARD_SESSION_SECRET` are required and have no defaults.

The Docker images additionally set the adapter-node runtime variables
`PORT=3000`, `HOST=0.0.0.0`, `ADDRESS_HEADER=X-Forwarded-For`, and `XFF_DEPTH=1`
so the Node server trusts the single nginx hop when reading the client IP.

### 2. Install & develop

The bot and web are two packages, each installed/run independently:

```bash
# Bot (repo root)
npm install
npm run dev                    # tsx watch source/index.ts

# Web (dashboard/)
cd dashboard && npm install
npm run dev                    # vite dev
```

> The bot's `package.json` lives at the repo root (the bot sources sit in
> `source/`). The dashboard reads its env from the **repo-root `.env`** —
> `dashboard/svelte.config.js` sets `kit.env.dir: ".."`, so a single root `.env`
> serves both packages. There is no separate `dashboard/.env`.

### 3. Register slash commands

```bash
npm run deploy   # tsx source/deploy-commands.ts — registers /verify
```

### 4. Build (without Docker)

```bash
npm run build                 # bot:  tsc -p tsconfig.build.json -> dist/
cd dashboard && npm run build # web:  vite build (adapter-node) -> build/
```

---

## Deployment

```bash
docker compose up -d --build
```

This brings up three services on the `internal` network:

- **cfg-redis** — `redis:7-alpine`, persisted to the `redis-data` volume.
- **cfg-bot** — no exposed ports; connects out to Discord / Mongo / Redis.
- **cfg-web** — exposed on port 3000, also joined to the external `proxiable`
  network so nginx can reach it.

MongoDB is external — point `MONGODB_URI` at your own instance.

The `proxiable` network must already exist (shared with nginx):

```bash
docker network create proxiable   # if it does not exist yet
```

### nginx

CFG sits behind nginx on the shared `proxiable` network. nginx must forward the
real client IP — VPN detection depends on `X-Forwarded-For`.

```nginx
server {
    listen 443 ssl http2;
    server_name cfg.ly.ax;

    # ssl_certificate / ssl_certificate_key ...

    location / {
        proxy_pass http://cfg-web:3000;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

> `proxy_pass http://cfg-web:3000` works when nginx runs in a container on the
> `proxiable` network. If nginx runs on the host instead, publish the web port
> and use `proxy_pass http://127.0.0.1:<published-port>`.

---

## Multi-account policy

CFG limits how many verified accounts can come from the same IP. It only runs on
a clean (non-VPN) IP, matches against a salted IP hash, confirms the linked
account is still in the server, and ignores matches older than
`MULTI_ACCOUNT_IP_WINDOW_DAYS`. Shared-network connection types
(`MULTI_ACCOUNT_LENIENT_CONN_TYPES` — mobile, corporate, education) are softened
from block to flag, since those legitimately front many people.

- **`block`** (default) — deny verification; the alt is not granted the role.
- **`flag`** — grant the role but post a staff alert for review.
- **`off`** — disable the multi-account check entirely.

---

## Security & privacy

- **IPs are hashed at rest.** Raw client IPs are never stored — they are hashed
  with SHA-256 using `IP_HASH_SALT` (see `dashboard/src/lib/server/ip.ts`). Set a
  strong, secret salt and do not rotate it casually (it invalidates existing
  multi-account matches).
- **Minimal PII.** CFG stores guild/role IDs, hashed IPs, and verification
  outcomes — not browsing data or raw addresses.
- **Single-use tokens.** Verification links carry one-time tokens stored in Redis
  (`cfg:token:`) and are consumed on use.
- **Fail policy.** If both detection providers are unavailable, `FAIL_MODE`
  decides the outcome — `open` (default) lets the user through and logs it for
  review, `closed` blocks. Pick `closed` if a brief outage must never let a VPN slip past.
- **Secrets** (`DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_SECRET`,
  `DASHBOARD_SESSION_SECRET`, `IP_HASH_SALT`, API keys) belong only in `.env`,
  which is gitignored and excluded from the Docker build context via
  `.dockerignore`.

---

## License

Private / self-hosted.
