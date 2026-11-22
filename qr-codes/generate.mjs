// Generates styled QR cards (SVG + PNG) for each APK environment, plus a combined sheet.
// Usage: npm run generate        Output: ./out/{dev,test,pilot}.{svg,png}, ./out/all.png

import { mkdir, writeFile } from "node:fs/promises";
import QRCode from "qrcode";
import sharp from "sharp";
import { BASE_URL, ENVIRONMENTS, OUT_DIR, urlFor } from "./config.mjs";

const CARD_WIDTH = 1000;
const CARD_HEIGHT = 1320;
const BAND_HEIGHT = 300;
const QR_SIZE_PX = 700;
const QR_TOP = 370;
const PNG_SCALE = 2;
// Modules are full-size rounded squares: neighbours touch (unbroken runs keep decoders happy)
// while isolated modules keep the soft rounded look. Gaps or circles fail some decoders.
const DOT_SIZE = 1.0; // in modules
const DOT_CORNER = 0.3; // corner radius, in modules
const BADGE_FRACTION = 0.2; // badge width relative to the QR's module count
const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

const escapeXml = (s) =>
  s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);

const isInFinder = (row, col, size) =>
  (row < 7 && col < 7) || (row < 7 && col >= size - 7) || (row >= size - 7 && col < 7);

function finderPattern(x, y, unit, color) {
  const outer = 7 * unit;
  return `
    <rect x="${x + unit / 2}" y="${y + unit / 2}" width="${outer - unit}" height="${outer - unit}"
          rx="${unit * 1.6}" fill="none" stroke="${color}" stroke-width="${unit}"/>
    <rect x="${x + 2 * unit}" y="${y + 2 * unit}" width="${3 * unit}" height="${3 * unit}"
          rx="${unit * 0.9}" fill="${color}"/>`;
}

function qrMarkup(url, color, letter) {
  const qr = QRCode.create(url, { errorCorrectionLevel: "H" });
  const size = qr.modules.size;
  const unit = QR_SIZE_PX / size;
  const x0 = (CARD_WIDTH - QR_SIZE_PX) / 2;
  const y0 = QR_TOP;

  const badgeModules = Math.ceil(size * BADGE_FRACTION) | 1; // odd, so it centres on a module
  const badgeStart = (size - badgeModules) / 2;
  const isUnderBadge = (r, c) =>
    r >= badgeStart && r < badgeStart + badgeModules && c >= badgeStart && c < badgeStart + badgeModules;

  const dots = [];
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (!qr.modules.get(r, c) || isInFinder(r, c, size) || isUnderBadge(r, c)) continue;
      const inset = ((1 - DOT_SIZE) / 2) * unit;
      dots.push(
        `<rect x="${(x0 + c * unit + inset).toFixed(2)}" y="${(y0 + r * unit + inset).toFixed(2)}" ` +
          `width="${(DOT_SIZE * unit).toFixed(2)}" height="${(DOT_SIZE * unit).toFixed(2)}" rx="${(DOT_CORNER * unit).toFixed(2)}"/>`,
      );
    }
  }

  const finders = [
    finderPattern(x0, y0, unit, color),
    finderPattern(x0 + (size - 7) * unit, y0, unit, color),
    finderPattern(x0, y0 + (size - 7) * unit, unit, color),
  ].join("");

  const badgePx = badgeModules * unit;
  const bx = x0 + badgeStart * unit;
  const by = y0 + badgeStart * unit;
  const badge = `
    <rect x="${bx + unit * 0.6}" y="${by + unit * 0.6}" width="${badgePx - unit * 1.2}" height="${badgePx - unit * 1.2}"
          rx="${unit * 2}" fill="${color}"/>
    <text x="${bx + badgePx / 2}" y="${by + badgePx / 2}" dy="0.35em" text-anchor="middle"
          font-family="${FONT}" font-weight="800" font-size="${badgePx * 0.55}" fill="#fff">${escapeXml(letter)}</text>`;

  return `<g fill="${color}">${dots.join("")}</g>${finders}${badge}`;
}

function cardSvg(envKey, { label, color, colorDark }) {
  const url = urlFor(envKey);
  const shortUrl = url.replace(/^https?:\/\//, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
  <defs>
    <linearGradient id="band" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${color}"/>
      <stop offset="1" stop-color="${colorDark}"/>
    </linearGradient>
    <clipPath id="card"><rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="56"/></clipPath>
  </defs>
  <g clip-path="url(#card)">
    <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="#ffffff"/>
    <rect width="${CARD_WIDTH}" height="${BAND_HEIGHT}" fill="url(#band)"/>
    <circle cx="${CARD_WIDTH - 40}" cy="-20" r="190" fill="#ffffff" opacity="0.08"/>
    <circle cx="60" cy="${BAND_HEIGHT + 30}" r="120" fill="#ffffff" opacity="0.06"/>
    <text x="${CARD_WIDTH / 2}" y="100" text-anchor="middle" font-family="${FONT}" font-weight="600"
          font-size="30" letter-spacing="8" fill="#ffffff" opacity="0.85">LATEST ANDROID BUILD</text>
    <text x="${CARD_WIDTH / 2}" y="238" text-anchor="middle" font-family="${FONT}" font-weight="800"
          font-size="150" letter-spacing="10" fill="#ffffff">${escapeXml(label)}</text>
    ${qrMarkup(url, colorDark, label[0])}
    <text x="${CARD_WIDTH / 2}" y="${QR_TOP + QR_SIZE_PX + 100}" text-anchor="middle" font-family="${FONT}"
          font-weight="700" font-size="40" fill="#1f2937">Scan to download &amp; install</text>
    <text x="${CARD_WIDTH / 2}" y="${QR_TOP + QR_SIZE_PX + 152}" text-anchor="middle" font-family="${FONT}"
          font-size="26" fill="#6b7280">${escapeXml(shortUrl)}</text>
    <rect y="${CARD_HEIGHT - 18}" width="${CARD_WIDTH}" height="18" fill="url(#band)"/>
  </g>
</svg>`;
}

async function renderPng(svg, path) {
  await sharp(Buffer.from(svg), { density: 72 * PNG_SCALE }).png().toFile(path);
}

async function renderSheet(svgs, path) {
  const gap = 60 * PNG_SCALE;
  const w = CARD_WIDTH * PNG_SCALE;
  const h = CARD_HEIGHT * PNG_SCALE;
  const cards = await Promise.all(
    svgs.map((svg) => sharp(Buffer.from(svg), { density: 72 * PNG_SCALE }).png().toBuffer()),
  );
  await sharp({
    create: {
      width: gap + svgs.length * (w + gap),
      height: h + 2 * gap,
      channels: 4,
      background: "#eef0f4",
    },
  })
    .composite(cards.map((input, i) => ({ input, left: gap + i * (w + gap), top: gap })))
    .png()
    .toFile(path);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const svgs = [];
  for (const [envKey, style] of Object.entries(ENVIRONMENTS)) {
    const svg = cardSvg(envKey, style);
    svgs.push(svg);
    await writeFile(`${OUT_DIR}/${envKey}.svg`, svg);
    await renderPng(svg, `${OUT_DIR}/${envKey}.png`);
    console.info(`✓ ${style.label.padEnd(5)} -> ${urlFor(envKey)}`);
  }
  await renderSheet(svgs, `${OUT_DIR}/all.png`);
  console.info(`✓ Combined sheet -> ${OUT_DIR}/all.png  (base: ${BASE_URL})`);
}

main().catch((err) => {
  console.error("QR generation failed:", err);
  process.exit(1);
});
