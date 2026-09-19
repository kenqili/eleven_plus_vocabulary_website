import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
// OWASP's 16 MiB scrypt profile keeps concurrent Worker requests within memory limits.
const options = { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 };
export function hashPassword(
  password: string,
  salt = randomBytes(16).toString("hex"),
) {
  return `scrypt$${salt}$${scryptSync(password, salt, 32, options).toString("hex")}`;
}
export function verifyPassword(password: string, stored: string) {
  const [algorithm, salt, digest] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !/^[a-f0-9]{64}$/.test(digest || ""))
    return false;
  return timingSafeEqual(
    Buffer.from(digest, "hex"),
    Buffer.from(hashPassword(password, salt).split("$")[2], "hex"),
  );
}
export const tokenDigest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("hex");
