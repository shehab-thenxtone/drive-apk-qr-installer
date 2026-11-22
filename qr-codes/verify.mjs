// Decodes every generated PNG at full size and at smaller "phone at arm's length" sizes,
// and checks it resolves to the expected URL. Exits non-zero on any mismatch.
// Usage: npm run verify

import jsQR from "jsqr";
import sharp from "sharp";
import { ENVIRONMENTS, OUT_DIR, urlFor } from "./config.mjs";

const TEST_WIDTHS = [null, 600, 360];

async function decode(path, width) {
  const pipeline = sharp(path).flatten({ background: "#ffffff" });
  const { data, info } = await (width ? pipeline.resize({ width }) : pipeline)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data ?? null;
}

let failures = 0;
for (const envKey of Object.keys(ENVIRONMENTS)) {
  const expected = urlFor(envKey);
  for (const width of TEST_WIDTHS) {
    const got = await decode(`${OUT_DIR}/${envKey}.png`, width);
    const ok = got === expected;
    if (!ok) failures += 1;
    console.info(`${ok ? "✓" : "✗"} ${envKey.padEnd(5)} @ ${String(width ?? "full").padEnd(4)} -> ${got ?? "no QR found"}`);
  }
}

if (failures > 0) {
  console.error(`${failures} decode check(s) failed`);
  process.exit(1);
}
console.info("All QR codes decode to the expected URLs.");
