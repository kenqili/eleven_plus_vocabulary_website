import vinext from "vinext";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import hostingConfig from "./.openai/hosting.json";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";
const SITE_CREATOR_PLACEHOLDER_DATABASE_NAME = "site-creator-d1";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";

/**
 * The D1 binding the build writes into dist/server/wrangler.json.
 *
 * A build for the hosted platform leaves the placeholder in place, because that
 * control plane injects the real binding when it deploys. A build for a
 * self-hosted Worker has no such injection step, so it has to say which
 * database it means. Reading D1_ID here is what makes `D1_ID=... npm run build`
 * produce a config that already points at the right database, rather than
 * emitting a placeholder and needing a patch step afterwards to replace it.
 *
 * Only honoured for a build. Under serve the Cloudflare plugin talks to a local
 * Miniflare store, and pointing that at a production database id would be wrong
 * even when the variable happens to be set in the shell.
 */
const bindingConfig = (command: string) => ({
  main: "vinext/server/fetch-handler",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name:
            (command === "build" && process.env.D1_NAME) ||
            SITE_CREATOR_PLACEHOLDER_DATABASE_NAME,
          database_id:
            (command === "build" && process.env.D1_ID) ||
            SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
});

export default defineConfig(async ({ command }) => {
  const localBindingConfig = bindingConfig(command);
  const nodeDev = command === "serve" && process.env.MINEWORDS_NODE_DEV === "1";
  // Use Miniflare's local Request.cf placeholder unless fetching is requested.
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const workerPlugins = nodeDev ? [] : [(await import("@cloudflare/vite-plugin")).cloudflare({
    viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
    inspectorPort: false,
    config: localBindingConfig,
  })];

  return {
    resolve: nodeDev ? {
      alias: { "cloudflare:workers": fileURLToPath(new URL("./scripts/node-dev-env.mjs", import.meta.url)) },
    } : undefined,
    server: {
      ...(nodeDev ? { host: "0.0.0.0" } : {}),
      ...(managedLinux ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] } : {}),
      ...(isCodexSeatbeltSandbox ? { watch: { useFsEvents: false, usePolling: true } } : {}),
    },
    plugins: [
      vinext(),
      sites({ mockAuth: !managedLinux }),
      ...workerPlugins,
    ],
  };
});
