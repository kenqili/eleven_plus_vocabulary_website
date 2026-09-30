/**
 * What esbuild is pointed at, and nothing more.
 *
 * The file under test is a Next.js route, which reaches for two things a plain
 * node process cannot resolve: the `@/` path alias from tsconfig.json, and the
 * `cloudflare:workers` module the Worker runtime provides. Rather than teach
 * this process either of them, esbuild is given both as aliases when
 * tests/password-reset.integration.mjs builds the bundle - `@` to the
 * repository root, and `cloudflare:workers` to workers-env.ts beside this file.
 *
 * So this is the only committed source in the harness, and it is one line: the
 * bundle under test is the route as written, not a copy of it.
 */
export { GET, POST } from "@/app/api/password-reset/[action]/route";
