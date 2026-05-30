# Control Flow Guard — Design Language

**Brand:** Control Flow Guard (CFG)
**Domain:** cfg.ly.ax

---

## Voice & tone

Quiet, technical, operational. CFG is a gate, not a greeter — it states what it
is doing and what it found, nothing more. Copy is terse and factual. No hype, no
exclamation marks, no marketing. Prefer present-tense verbs and plain nouns:
"Checking your connection.", "Verified.", "Connection blocked.". When something
fails, say why in one line and stop.

---

## Color

Built on a neutral zinc foundation with a single indigo accent. Status colors are
reserved strictly for verification outcomes.

| Token | Hex | Use |
|-------|-----|-----|
| `--bg` | `#09090b` | Page background (zinc-950) |
| `--surface` | `#18181b` | Cards, panels (zinc-900) |
| `--border` | `#27272a` | Hairline borders (zinc-800) |
| `--text` | `#fafafa` | Primary text (zinc-50) |
| `--muted` | `#a1a1aa` | Secondary text (zinc-400) |
| `--accent` | `#6366f1` | Indigo — primary accent, links, focus, spinner |
| `--ok` | `#34d399` | Pass / verified |
| `--warn` | `#fbbf24` | Caution / flagged (multi-account) |
| `--danger` | `#f87171` | Fail / blocked |

---

## Type

- **Display / headings:** *Sora*, sans-serif.
- **Body:** system-ui, sans-serif.
- **Code / labels / status:** *JetBrains Mono*, monospace.

Headings are tight (letter-spacing -0.02em). Labels and status pills are uppercase
with wide tracking (0.08em).

---

## Layout

- Verification is a single centered card on a near-black field. Max card width
  ~440px; the page never scrolls under normal flow.
- Generous vertical rhythm (1.6 line-height body).
- Hairline borders over shadows. Shadows only for the verification card lift.
- Rounded corners: 12px card, 8px buttons, 6px inputs.

---

## Iconography

lucide icons, stroke 1.5. Core marks:

- **shield-check** — brand mark and the verified/pass state.
- **scan-eye** — the active "checking your connection" state.
- **shield-x / ban** — blocked state.

---

## Verification states

The verify page moves through three explicit states, each with its own icon,
color, and one-line status:

| State | Icon | Color | Status line |
|-------|------|-------|-------------|
| Checking | scan-eye (animated) | `--accent` | "Checking your connection…" |
| Pass | shield-check | `--ok` | "Verified — you can return to Discord." |
| Fail | shield-x | `--danger` | "Connection blocked. <reason>." |

The **result page** restates the outcome plainly: a single colored icon, the
outcome word in mono uppercase, and a short reason (e.g. "VPN or proxy detected",
"Too many accounts from this network"). No retry theater — if it failed, the user
is told what to change (disconnect VPN) and to run `/verify` again.

---

## Components

- **Status pill:** rounded-full, uppercase JetBrains Mono label, colored dot + text.
- **Card:** surface bg, hairline border, 12px radius, 28px padding, centered.
- **Button:** indigo bg for primary ("Continue with Discord"), ghost (border only)
  for secondary.

---

(Design tokens mirrored in dashboard/src/app.css and the Tailwind/Svelte theme.)
