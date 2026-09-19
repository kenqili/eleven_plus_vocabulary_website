import { createHmac, timingSafeEqual } from "node:crypto";
export function verifyStripeSignature(
  raw: string,
  signature: string,
  secret: string,
  now = Math.floor(Date.now() / 1000),
) {
  const parts = signature.split(",").map((x) => x.split("="));
  const stamp = parts.find((x) => x[0] === "t")?.[1];
  if (
    !stamp ||
    !/^\d+$/.test(stamp) ||
    Math.abs(now - Number(stamp)) > 300 ||
    !secret
  )
    return false;
  const expected = createHmac("sha256", secret)
    .update(`${stamp}.${raw}`)
    .digest();
  return parts.some(
    ([key, value]) =>
      key === "v1" &&
      /^[a-f0-9]{64}$/.test(value || "") &&
      timingSafeEqual(expected, Buffer.from(value, "hex")),
  );
}
