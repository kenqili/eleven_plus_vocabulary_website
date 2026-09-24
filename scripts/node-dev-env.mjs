import { resolve } from "node:path";
import { openLocalDatabase } from "./node-dev-db.mjs";

const key = Symbol.for("minewords.node-dev.database");
export const env = {
  ...process.env,
  get DB() {
    return globalThis[key] ??= openLocalDatabase(resolve(".sites-runtime/node-dev.sqlite"));
  },
};
