import { getToken } from "$lib/server/redis.js";
import type { PageServerLoad } from "./$types.js";

/**
 * Validate the verify token WITHOUT consuming it. The landing page only needs
 * to know whether to show the privacy notice + "Verify with Discord" button
 * (valid) or the "link invalid or expired" alert (missing/expired). The token
 * is single-use and is only consumed (GETDEL) in the OAuth callback, so a user
 * who reloads the landing page or bails before OAuth keeps a usable link.
 */
export const load: PageServerLoad = async ({ params }) => {
  const payload = await getToken(params.token).catch(() => null);
  return { valid: payload !== null };
};
