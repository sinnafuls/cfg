import { defineConfig, type Plugin } from "vitest/config";
import { fileURLToPath } from "node:url";

// SvelteKit exposes `$env/dynamic/private` as a virtual module that only
// exists when the kit plugin is running. Our unit tests deliberately skip the
// kit plugin (so they're fast and don't need a built app), so we resolve the
// virtual id ourselves to a tiny stub. A resolveId/load plugin is more robust
// than a `resolve.alias` entry here because it intercepts the bare virtual id
// no matter whether a module imports it directly or transitively.
//
// The stub mirrors `process.env` so a test can populate the provider API keys
// (e.g. `process.env.IPQS_API_KEY = "x"`) before exercising the real
// key-reading code paths in fraud.ts. The pure functions (decide(),
// decideMultiAccount()) ignore env entirely.
const STUB = `export const env = new Proxy({}, { get: (_t, k) => process.env[k] });`;

function envStub(): Plugin {
  const VIRTUAL = "$env/dynamic/private";
  const RESOLVED = "\0cfg-env-dynamic-private";
  return {
    name: "cfg-env-stub",
    enforce: "pre",
    resolveId(id) {
      if (id === VIRTUAL) return RESOLVED;
      return null;
    },
    load(id) {
      if (id === RESOLVED) return STUB;
      return null;
    },
  };
}

export default defineConfig({
  plugins: [envStub()],
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.{test,spec}.{js,ts}"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/lib/server/fraud.ts", "src/lib/server/multiAccount.ts"],
      reporter: ["text", "text-summary"],
    },
  },
});
