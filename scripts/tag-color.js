// STEP 3c · PROGRAMMATIC TAGS (colour)
// Download the Twemoji SVG for each base emoji, rasterise it, and count the
// opaque pixels per colour bucket. Assign a colour tag only when the dominant
// hue covers at least 45 percent of the filled (opaque) area. Confidence is
// that coverage ratio. SVGs are cached in .cache/svg so reruns are instant and
// fully deterministic.
//
// Buckets: red, orange, yellow, green, blue, purple, pink, brown, black, white, gray.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { ROOT, readJSON, writeCharKeyedJSON, ensureDir, makeTag, log } from "../lib/util.js";

const CDN = "https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg";
const CACHE = `${ROOT}/.cache/svg`;
const CONCURRENCY = 24;
const COVERAGE_MIN = 0.45;
const RENDER = 64; // pixels per side, enough to make the dominant hue stable

// ---------------------------------------------------------------------------
// Twemoji asset naming: keep FE0F only when the sequence has a ZWJ join.
function twemojiName(hexcode) {
  let parts = hexcode.split("-");
  if (!parts.includes("200D")) parts = parts.filter((p) => p !== "FE0F");
  return parts.map((p) => p.toLowerCase()).join("-");
}

async function loadSvg(name) {
  const file = `${CACHE}/${name}.svg`;
  if (existsSync(file)) return { svg: readFileSync(file, "utf8"), cached: true };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${CDN}/${name}.svg`, { signal: controller.signal });
    if (!res.ok) return { svg: null, cached: false };
    const svg = await res.text();
    writeFileSync(file, svg);
    return { svg, cached: false };
  } catch {
    return { svg: null, cached: false };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return { h, s, l };
}

// Map an RGB pixel to one of the 11 buckets.
function bucketOf(r, g, b) {
  const { h, s, l } = rgbToHsl(r, g, b);
  if (s < 0.15) {
    if (l < 0.22) return "black";
    if (l > 0.85) return "white";
    return "gray";
  }
  // Brown is a warm hue that is muted (lower saturation) and not too light.
  // This separates terracotta and wood from a vivid orange.
  if (h >= 10 && h <= 45 && s <= 0.6 && l <= 0.58) return "brown";
  // Pink is a light red or magenta.
  if ((h >= 330 || h <= 12) && l >= 0.62) return "pink";
  if (h >= 300 && h < 330 && l >= 0.55) return "pink";
  if (h < 14 || h >= 345) return "red";
  // Cartoon emoji yellow (faces, hands) sits near hue 43, so orange stops at 40.
  if (h < 40) return "orange";
  if (h < 70) return "yellow";
  if (h < 170) return "green";
  if (h < 255) return "blue";
  if (h < 300) return "purple";
  return "pink";
}

// Rasterise and tally opaque pixels per bucket. Returns the dominant bucket
// with its coverage ratio, or null when nothing renders.
function analyze(svg) {
  let img;
  try {
    img = new Resvg(svg, { fitTo: { mode: "width", value: RENDER } }).render();
  } catch {
    return null;
  }
  const px = img.pixels;
  const buckets = {};
  let total = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 200) continue; // skip transparent and anti aliased fringe
    const bucket = bucketOf(px[i], px[i + 1], px[i + 2]);
    buckets[bucket] = (buckets[bucket] || 0) + 1;
    total += 1;
  }
  if (total <= 0) return null;
  let best = null;
  for (const [bucket, n] of Object.entries(buckets)) {
    const coverage = n / total;
    if (!best || coverage > best.coverage) best = { bucket, coverage };
  }
  return best;
}

// ---------------------------------------------------------------------------
async function run(force) {
  ensureDir(CACHE);
  const records = readJSON(`${ROOT}/data/records.json`);
  const bases = records.filter((r) => r.base === null);
  const store = force ? {} : loadExisting();

  const todo = bases.filter((r) => force || !(r.char in store));
  const stats = { downloaded: 0, cached: 0, missing: 0, tagged: 0, weak: 0 };

  let index = 0;
  async function worker() {
    while (index < todo.length) {
      const r = todo[index++];
      const name = twemojiName(r._hexcode);
      const { svg, cached } = await loadSvg(name);
      if (!svg) {
        stats.missing += 1;
        continue;
      }
      stats[cached ? "cached" : "downloaded"] += 1;
      const best = analyze(svg);
      if (best && best.coverage >= COVERAGE_MIN) {
        store[r.char] = [makeTag(best.bucket, "color", best.coverage, "programmatic")];
        stats.tagged += 1;
      } else if (best) {
        stats.weak += 1;
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  writeCharKeyedJSON(`${ROOT}/data/tags/color.json`, store);

  const byColor = {};
  for (const tags of Object.values(store)) byColor[tags[0].tag] = (byColor[tags[0].tag] || 0) + 1;

  log("COLOUR TAGS complete");
  log(`  base emojis analysed  ${todo.length}`);
  log(`  downloaded ${stats.downloaded}   cached ${stats.cached}   missing artwork ${stats.missing}`);
  log(`  tagged ${stats.tagged}   below ${COVERAGE_MIN} coverage ${stats.weak}`);
  for (const key of Object.keys(byColor).sort()) log(`    ${key.padEnd(8)} ${byColor[key]}`);
  log(`  wrote                 data/tags/color.json`);
}

function loadExisting() {
  const path = `${ROOT}/data/tags/color.json`;
  return existsSync(path) ? readJSON(path) : {};
}

run(process.argv.includes("--force"));
