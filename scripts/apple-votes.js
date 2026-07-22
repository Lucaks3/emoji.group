// APPLE COLOUR VOTES · helper for tag-color.js
// Apple's emoji artwork ships inside macOS and cannot be downloaded like
// Twemoji or Noto, but it is what most users actually see. On a Mac this
// script renders every base emoji with the system emoji font in headless
// Chrome, counts pixels per colour bucket in-page via canvas, and caches the
// per emoji dominant bucket in .cache/apple-votes.json. tag-color.js then
// treats Apple as a vendor with veto power: a colour tag never ships when
// Apple's artwork clearly disagrees.
//
// On machines without Chrome or the Apple font the cache is simply absent and
// tag-color falls back to the three downloadable vendors.

import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { ROOT, readJSON, ensureDir, log } from "../lib/util.js";

const CACHE = `${ROOT}/.cache/apple-votes.json`;
const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
];

export function loadAppleVotes() {
  if (existsSync(CACHE)) return readJSON(CACHE);
  const generated = generate();
  return generated;
}

function chromePath() {
  if (process.platform !== "darwin") return null;
  return CHROME_PATHS.find((p) => existsSync(p)) || null;
}

function generate() {
  const chrome = chromePath();
  if (!chrome) {
    log("  apple votes unavailable (no macOS Chrome); continuing with 3 vendors");
    return null;
  }
  const records = readJSON(`${ROOT}/data/records.json`);
  const chars = records.filter((r) => r.base === null).map((r) => r.char);

  // The page draws each emoji on a canvas and buckets pixels with the same
  // rules as tag-color.js, then leaves the JSON result in a <pre> for
  // --dump-dom to pick up.
  const html = `<!DOCTYPE html><meta charset="utf-8"><body><script>
  var CHARS = ${JSON.stringify(chars)};
  function bucketOf(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2, h = 0, s = 0, d = max - min;
    if (d !== 0) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
      else if (max === g) h = ((b - r) / d + 2) * 60;
      else h = ((r - g) / d + 4) * 60;
    }
    if (s < 0.15) { if (l < 0.22) return "black"; if (l > 0.85) return "white"; return "gray"; }
    if (h >= 10 && h <= 45 && s <= 0.6 && l <= 0.58) return "brown";
    if ((h >= 330 || h <= 12) && l >= 0.62) return "pink";
    if (h >= 300 && h < 330 && l >= 0.55) return "pink";
    if (h < 14 || h >= 345) return "red";
    if (h < 40) return "orange";
    if (h < 70) return "yellow";
    if (h < 170) return "green";
    if (h < 255) return "blue";
    if (h < 300) return "purple";
    return "pink";
  }
  var SIZE = 64;
  var canvas = document.createElement("canvas");
  canvas.width = SIZE; canvas.height = SIZE;
  var ctx = canvas.getContext("2d", { willReadFrequently: true });
  var out = {};
  for (var i = 0; i < CHARS.length; i++) {
    var ch = CHARS[i];
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.font = "56px 'Apple Color Emoji'";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(ch, SIZE / 2, SIZE / 2);
    var px = ctx.getImageData(0, 0, SIZE, SIZE).data;
    var buckets = {}, total = 0;
    for (var p = 0; p < px.length; p += 4) {
      if (px[p + 3] < 200) continue;
      var bkt = bucketOf(px[p], px[p + 1], px[p + 2]);
      buckets[bkt] = (buckets[bkt] || 0) + 1;
      total++;
    }
    if (total < 300) { out[ch] = null; continue; } // did not render usefully
    var best = null;
    for (var k in buckets) {
      var cov = buckets[k] / total;
      if (!best || cov > best.coverage) best = { bucket: k, coverage: Math.round(cov * 1000) / 1000 };
    }
    out[ch] = best;
  }
  var pre = document.createElement("pre");
  pre.id = "OUT";
  pre.textContent = JSON.stringify(out);
  document.body.appendChild(pre);
  </script></body>`;

  ensureDir(`${ROOT}/.cache`);
  const pagePath = `${ROOT}/.cache/apple-render.html`;
  writeFileSync(pagePath, html);

  log("  rendering Apple artwork via headless Chrome…");
  let dom;
  try {
    dom = execFileSync(
      chrome,
      ["--headless=new", "--disable-gpu", "--virtual-time-budget=30000", "--dump-dom", `file://${pagePath}`],
      { maxBuffer: 128 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
    ).toString();
  } catch {
    log("  apple votes unavailable (Chrome render failed); continuing with 3 vendors");
    return null;
  }
  const match = dom.match(/<pre id="OUT">([\s\S]*?)<\/pre>/);
  if (!match) {
    log("  apple votes unavailable (no output captured); continuing with 3 vendors");
    return null;
  }
  // Decode the HTML entities the DOM dump introduces in JSON.
  const json = match[1]
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  const votes = JSON.parse(json);
  writeFileSync(CACHE, JSON.stringify(votes, null, 2) + "\n");
  const counted = Object.values(votes).filter(Boolean).length;
  log(`  apple votes cached for ${counted} emojis`);
  return votes;
}
