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
  const workerPlugins = nodeDev
    ? []
    : [
        (await import("@cloudflare/vite-plugin")).cloudflare({
          viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
          inspectorPort: false,
          config: localBindingConfig,
        }),
      ];

  return {
    resolve: nodeDev
      ? {
          alias: {
            "cloudflare:workers": fileURLToPath(
              new URL("./scripts/node-dev-env.mjs", import.meta.url),
            ),
          },
        }
      : undefined,
    /**
     * Unminified. This is no longer the fix for anything - it was a guess that
     * was wrong, and the record of why matters more than the setting.
     *
     * The symptom was that every link in the deployed app did nothing when
     * clicked, while `npm run dev` was fine. The old note here blamed
     * minification. It was not minification. The real cause was a circular
     * dynamic import between vinext's client entry and its Link shim: the entry
     * chunk imported the Link chunk, and the Link chunk imported the entry chunk
     * back to reach `navigateClientSide` and `getPrefetchInterceptionContext`.
     * A cycle like that makes the bundler leave those names out of the entry
     * chunk's export list, so the Link chunk destructured them off a namespace
     * that did not have them, got `undefined`, and threw "navigateClientSide is
     * not a function" on the first click - after calling `preventDefault`, so
     * the browser never navigated either. That is why it looked like the links
     * were simply dead, and why it only ever appeared in a production build:
     * dev never chunks this way.
     *
     * It is fixed by the framework, not here. vinext 1.0.0 resolves those
     * lookups through an explicit `navigation_exports` namespace object instead
     * of the module namespace, which survives chunking, and the cycle is gone
     * from the emitted graph. Confirmed by inspecting the built chunks: the
     * names `link` needs are present in the object it destructures, and no two
     * chunks import each other.
     *
     * Tried and rejected as fixes: `output.inlineDynamicImports` (deprecated by
     * rolldown and silently ignored while `codeSplitting` is set, which the
     * Cloudflare plugin does set), and `codeSplitting: false` in `rollupOptions`
     * (the Cloudflare Vite plugin owns the client environment's output config
     * outright - a deliberately conspicuous `entryFileNames` probe never reached
     * the client build, so this file cannot fix a client chunking problem at
     * all).
     *
     * `minify: false` is kept, and it is now only a performance cost rather
     * than a fix. Measured on this build: 1,872 KB of client JavaScript
     * unminified against 964 KB minified, so turning it on saves about 908 KB,
     * 48% of the client bundle. Workers serves these from its edge cache, so
     * that is upload and cold-start parse time rather than per-request time.
     *
     * It is left off for the deploy that fixes the dead links, because that fix
     * cannot be verified on this machine - a production build needs workerd,
     * which needs macOS 13.5 - and shipping the fix together with an
     * unverifiable performance change means a second failure would be ambiguous.
     *
     * To turn it on afterwards, and check it rather than hope:
     *   1. set minify: true
     *   2. npm run build
     *   3. npm run verify:chunks   - must report no problems
     *   4. deploy, then click through the top menu on the deployed site
     *
     * Worth knowing about step 3: minification renames locals, so
     * `verify:chunks` can no longer see the dynamic-namespace destructures and
     * reports "0 dynamic namespace reads" where the shipped build reports 18.
     * The guard is strongest in exactly the configuration being shipped and
     * weaker in the one being considered, which is an argument for treating
     * step 4 as the real check.
     */
    build: { minify: false },
    server: {
      ...(nodeDev ? { host: "0.0.0.0" } : {}),
      ...(managedLinux
        ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] }
        : {}),
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [vinext(), sites({ mockAuth: !managedLinux }), ...workerPlugins],
  };
});
