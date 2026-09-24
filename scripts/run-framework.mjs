import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readExecutionProfile } from "./execution-profile.mjs";

const [command, ...args] = process.argv.slice(2);
if (!["dev", "build"].includes(command)) throw new Error("Expected dev or build.");
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(
    `Node.js ${process.versions.node} is unsupported. Use Node.js 22.13+ (24 recommended), then rerun npm run ${command}.`,
  );
  process.exit(1);
}
const managedLinux = readExecutionProfile() === "managed-linux";
const nodeMode = args.includes("--node");
if (nodeMode) {
  if (command !== "dev") throw new Error("--node is only supported for development.");
  args.splice(args.indexOf("--node"), 1);
  process.env.MINEWORDS_NODE_DEV = "1";
  try { process.loadEnvFile(); } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

if (managedLinux && command === "build") {
  const result = spawnSync("bash", [
    fileURLToPath(new URL("./build-verified.sh", import.meta.url)), ...args,
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

// Import in this process so the preview owner retains its PID and signals.
const cli = new URL(managedLinux
  ? "../node_modules/vite/bin/vite.js"
  : "../node_modules/vinext/dist/cli.js", import.meta.url);
process.argv = [process.execPath, fileURLToPath(cli), command,
  ...(!managedLinux && command === "dev" ? ["--port", "5173"] : []), ...args];
await import(cli.href);
