import { env } from "$env/dynamic/private";
import type { PageServerLoad } from "./$types.js";

export type ResultStatus =
  | "success"
  | "blocked"
  | "duplicate"
  | "error"
  | "pending";

/**
 * Apply the MULTI_ACCOUNT_REVEAL_USERNAME policy to the linked account's
 * display name before it ever reaches the browser:
 *   - "true"   → show the name as-is (the requested UX for this guild);
 *   - "masked" → keep first + last char, mask the middle (e.g. "Sh•••js");
 *   - "false"  → reveal nothing (the page shows a generic message).
 * Returns null when the name should not be shown at all.
 */
function applyRevealPolicy(name: string): string | null {
  const mode = env.MULTI_ACCOUNT_REVEAL_USERNAME ?? "true";
  if (mode === "false") return null;
  if (mode === "masked") {
    if (name.length <= 2) return "•".repeat(Math.max(name.length, 1));
    return `${name[0]}${"•".repeat(Math.min(name.length - 2, 4))}${name[name.length - 1]}`;
  }
  return name;
}

export const load: PageServerLoad = ({ url }) => {
  const raw = url.searchParams.get("status");
  const allowed: ResultStatus[] = [
    "success",
    "blocked",
    "duplicate",
    "error",
    "pending",
  ];
  const status: ResultStatus = allowed.includes(raw as ResultStatus)
    ? (raw as ResultStatus)
    : "error";

  // `until` (epoch ms) for a block; clamp to a number or null.
  const untilRaw = Number(url.searchParams.get("until"));
  const until = Number.isFinite(untilRaw) && untilRaw > 0 ? untilRaw : null;

  // The verify action timed out; user is verified but the role is syncing.
  const pending = url.searchParams.get("pending") === "1";

  // Linked account name for the duplicate state, gated by reveal policy.
  const asRaw = url.searchParams.get("as");
  const linkedName =
    status === "duplicate" && asRaw ? applyRevealPolicy(asRaw) : null;

  return { status, until, pending, linkedName };
};
