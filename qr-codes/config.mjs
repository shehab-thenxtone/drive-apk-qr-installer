// Shared settings for the QR generator and verifier.
// Keep the environment keys in sync with ENVIRONMENTS in ../latest-apk/src/index.js.

export const BASE_URL = "https://latest-apk.latest-apk.workers.dev";
export const OUT_DIR = new URL("./out", import.meta.url).pathname;

export const ENVIRONMENTS = Object.freeze({
  dev: { label: "DEV", color: "#6366F1", colorDark: "#3730A3" },
  test: { label: "TEST", color: "#F59E0B", colorDark: "#92400E" },
  pilot: { label: "PILOT", color: "#10B981", colorDark: "#047857" },
});

export const urlFor = (envKey) => `${BASE_URL}/${envKey}`;
