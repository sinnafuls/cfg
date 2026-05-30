import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  // Share the bot's .env at the project root rather than maintaining a
  // duplicate inside dashboard/. Vite loads .env* from this directory and
  // injects matching vars into process.env for the dev server. In Docker,
  // env vars come from compose's env_file (also pointed at the root .env)
  // so this setting only affects local `npm run dev` / `npm run build`.
  envDir: "..",
  plugins: [tailwindcss(), sveltekit()],
  server: {
    port: 5173,
  },
});
