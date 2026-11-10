// Renders the PWA/app icons from src/app/icon.svg. Run: node scripts/icons.mjs
// Uses sharp (a Next.js dependency). Output is committed; rerun after editing the SVG.
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const svg = readFileSync(new URL("../src/app/icon.svg", import.meta.url));
// Maskable icons need the artwork inside the central 80% safe zone on a full-bleed background.
const inner = svg.toString().replace('rx="112"', 'rx="0"');
const maskable = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#09090b"/>` +
    `<g transform="translate(64 64) scale(0.75)">${inner.replace(/<\/?svg[^>]*>/g, "")}</g></svg>`,
);

const out = (p) => new URL(`../${p}`, import.meta.url);
for (const size of [192, 512]) {
  writeFileSync(out(`public/icon-${size}.png`), await sharp(svg).resize(size, size).png().toBuffer());
  writeFileSync(out(`public/icon-maskable-${size}.png`), await sharp(maskable).resize(size, size).png().toBuffer());
}
writeFileSync(out("src/app/apple-icon.png"), await sharp(maskable).resize(180, 180).png().toBuffer());
console.log("icons written");
