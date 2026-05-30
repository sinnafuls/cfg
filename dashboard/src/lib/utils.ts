import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * HTML-escape a user-supplied string before interpolating it into markup.
 * Used for the multi-account "already in as <name>" message where the linked
 * account's display name is attacker-influenceable (a Discord display name
 * can contain `<`, `>`, `&`, quotes). Svelte auto-escapes `{...}` text, but
 * we escape at the data layer too as defence-in-depth and for any non-Svelte
 * sink (e.g. building a query string).
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
