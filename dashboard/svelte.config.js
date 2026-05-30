import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import("@sveltejs/kit").Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    env: {
      // Read .env from the project root (parent of dashboard/) so the web
      // shares the bot's env file. SvelteKit's $env/* modules use this
      // setting INDEPENDENTLY of Vite's `envDir` - both must be set to ".."
      // for the shared-env-file pattern to work.
      dir: "..",
      // Every CFG env var is server-only (bot token, OAuth secret, fraud
      // API keys, IP salt). Override the default "PUBLIC_" prefix to one we
      // never use so nothing is accidentally exposed to the client bundle.
      publicPrefix: "PUBLIC_CFG_",
    },
  },
};
