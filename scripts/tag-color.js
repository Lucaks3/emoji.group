// STEP 3c · PROGRAMMATIC TAGS (colour)
// Colour is measured, not guessed, and it must hold across vendors: the same
// emoji is drawn differently by Twitter, Google and OpenMoji (and Apple,
// whose artwork is not freely available). Twemoji's oil drum is blue while
// most platforms draw it brown, so single vendor measurement produces tags
// that look wrong to most users.
//
// Method: rasterise the artwork from three open sets (Twemoji, Noto,
// OpenMoji), count opaque pixels per colour bucket, and keep a vendor's vote
// only when its dominant hue covers at least 45 percent of the filled area.
// A colour tag is assigned only when at least two vendors agree on the same
// bucket; confidence is the mean coverage among the agreeing vendors.
// SVGs are cached in .cache/{twemoji,noto,openmoji} so reruns are offline and
// fully deterministic.
//
// Buckets: red, orange, yellow, green, blue, purple, pink, brown, black, white, gray.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { ROOT, readJSON, writeCharKeyedJSON, ensureDir, makeTag, round, log } from "../lib/util.js";
import { loadAppleVotes } from "./apple-votes.js";

const SELF = fileURLToPath(import.meta.url);

const CONCURRENCY = 24;
const COVERAGE_MIN = 0.45;
const RENDER = 64; // pixels per side, enough to make the dominant hue stable
const AGREE_MIN = 2; // vendors that must agree before a colour ships

// ---------------------------------------------------------------------------
// Vendor sources. Each maps an emojibase hexcode to candidate asset names,
// most likely first; the first URL that resolves is cached and used.

function stripFe0fUnlessZwj(parts) {
  return parts.includes("200D") ? parts : parts.filter((p) => p !== "FE0F");
}

const SOURCES = [
  {
    name: "twemoji",
    cache: `${ROOT}/.cache/twemoji`,
    candidates(hexcode) {
      const parts = hexcode.split("-");
      const kept = stripFe0fUnlessZwj(parts).map((p) => p.toLowerCase()).join("-");
      const bare = parts.filter((p) => p !== "FE0F").map((p) => p.toLowerCase()).join("-");
      return [...new Set([kept, bare])].map(
        (n) => `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/${n}.svg`,
      );
    },
  },
  {
    name: "noto",
    cache: `${ROOT}/.cache/noto`,
    candidates(hexcode) {
      const parts = hexcode.split("-");
      const bare = parts.filter((p) => p !== "FE0F").map((p) => p.toLowerCase()).join("_");
      const kept = parts.map((p) => p.toLowerCase()).join("_");
      return [...new Set([bare, kept])].map(
        (n) => `https://raw.githubusercontent.com/googlefonts/noto-emoji/v2.047/svg/emoji_u${n}.svg`,
      );
    },
  },
  {
    name: "openmoji",
    cache: `${ROOT}/.cache/openmoji`,
    candidates(hexcode) {
      const parts = hexcode.split("-");
      const full = parts.map((p) => p.toUpperCase()).join("-");
      const bare = parts.filter((p) => p !== "FE0F").map((p) => p.toUpperCase()).join("-");
      return [...new Set([full, bare])].map(
        (n) => `https://cdn.jsdelivr.net/npm/openmoji@15.1.0/color/svg/${n}.svg`,
      );
    },
  },
];

async function fetchFirst(urls, cachePath) {
  if (existsSync(cachePath)) {
    const cached = readFileSync(cachePath, "utf8");
    return cached === "" ? null : cached; // empty file records a known miss
  }
  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (res.ok) {
        const svg = await res.text();
        writeFileSync(cachePath, svg);
        return svg;
      }
    } catch {
      // try the next candidate
    } finally {
      clearTimeout(timer);
    }
  }
  writeFileSync(cachePath, ""); // cache the miss so reruns stay offline
  return null;
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
// Crash isolated rasterisation. resvg is native code and a malformed vendor
// SVG can panic the whole process, which try/catch cannot intercept. So the
// actual rendering runs in child processes; when a chunk crashes, it is
// bisected until the poisoned file is isolated and skipped (that vendor
// abstains for that emoji). Deterministic: the same file always crashes.

function analyzeChunkInProcess(paths) {
  const out = {};
  for (const p of paths) {
    out[p] = analyze(readFileSync(p, "utf8"));
  }
  return out;
}

function analyzeChunkIsolated(paths) {
  if (paths.length === 0) return {};
  const payload = JSON.stringify(paths);
  try {
    const stdout = execFileSync(process.execPath, [SELF, "--worker"], {
      input: payload,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["pipe", "pipe", "ignore"],
    });
    return JSON.parse(stdout.toString());
  } catch {
    if (paths.length === 1) {
      log(`  skipping malformed artwork: ${paths[0].replace(ROOT, "")}`);
      return { [paths[0]]: null };
    }
    const mid = Math.floor(paths.length / 2);
    return {
      ...analyzeChunkIsolated(paths.slice(0, mid)),
      ...analyzeChunkIsolated(paths.slice(mid)),
    };
  }
}

if (process.argv.includes("--worker")) {
  const chunks = [];
  process.stdin.on("data", (c) => chunks.push(c));
  process.stdin.on("end", () => {
    const paths = JSON.parse(Buffer.concat(chunks).toString());
    process.stdout.write(JSON.stringify(analyzeChunkInProcess(paths)));
  });
} else {
  run(process.argv.includes("--force"));
}

// Combine per vendor votes into a consensus tag, or null.
function consensus(votes) {
  const qualified = votes.filter((v) => v && v.coverage >= COVERAGE_MIN);
  const byBucket = new Map();
  for (const v of qualified) {
    if (!byBucket.has(v.bucket)) byBucket.set(v.bucket, []);
    byBucket.get(v.bucket).push(v.coverage);
  }
  let best = null;
  for (const [bucket, coverages] of byBucket) {
    if (coverages.length < AGREE_MIN) continue;
    const mean = coverages.reduce((a, b) => a + b, 0) / coverages.length;
    // More agreeing vendors wins; coverage breaks ties.
    if (
      !best ||
      coverages.length > best.n ||
      (coverages.length === best.n && mean > best.mean)
    ) {
      best = { bucket, n: coverages.length, mean };
    }
  }
  return best ? { bucket: best.bucket, confidence: round(best.mean) } : null;
}

// ---------------------------------------------------------------------------
async function run() {
  for (const s of SOURCES) ensureDir(s.cache);
  const records = readJSON(`${ROOT}/data/records.json`);
  const bases = records.filter((r) => r.base === null);

  // Phase A: make sure every vendor's artwork is cached (network only here).
  const perVendor = Object.fromEntries(SOURCES.map((s) => [s.name, 0]));
  let index = 0;
  async function downloadWorker() {
    while (index < bases.length) {
      const r = bases[index++];
      for (const source of SOURCES) {
        const cachePath = `${source.cache}/${r._hexcode}.svg`;
        const svg = await fetchFirst(source.candidates(r._hexcode), cachePath);
        if (svg) perVendor[source.name] += 1;
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, downloadWorker));

  // Phase B: rasterise every cached file in crash isolated chunks.
  const jobs = [];
  for (const r of bases) {
    for (const source of SOURCES) {
      const path = `${source.cache}/${r._hexcode}.svg`;
      if (existsSync(path) && readFileSync(path, "utf8") !== "") jobs.push(path);
    }
  }
  const votesByPath = {};
  const CHUNK = 250;
  for (let i = 0; i < jobs.length; i += CHUNK) {
    Object.assign(votesByPath, analyzeChunkIsolated(jobs.slice(i, i + CHUNK)));
  }

  // Apple's artwork, rendered locally where available. Apple is not just a
  // fourth vote: it holds a veto, because it is the artwork most users see.
  const appleVotes = loadAppleVotes();

  // Phase C: consensus per base emoji.
  const store = {};
  const stats = { tagged: 0, disagreed: 0, weak: 0, missing: 0, appleVeto: 0 };
  for (const r of bases) {
    const votes = [];
    let vendorsWithArt = 0;
    for (const source of SOURCES) {
      const path = `${source.cache}/${r._hexcode}.svg`;
      const vote = votesByPath[path];
      if (vote === undefined) {
        votes.push(null); // no artwork from this vendor
        continue;
      }
      vendorsWithArt += 1;
      votes.push(vote);
    }
    const apple = appleVotes ? appleVotes[r.char] : null;
    if (apple) votes.push(apple);
    const result = consensus(votes);
    if (result) {
      // Apple veto: if Apple's artwork has a clear dominant colour and it is
      // a different one, the tag does not ship.
      if (apple && apple.coverage >= COVERAGE_MIN && apple.bucket !== result.bucket) {
        stats.appleVeto += 1;
        continue;
      }
      store[r.char] = [makeTag(result.bucket, "color", result.confidence, "programmatic")];
      stats.tagged += 1;
    } else if (vendorsWithArt < AGREE_MIN) {
      stats.missing += 1;
    } else if (votes.some((v) => v && v.coverage >= COVERAGE_MIN)) {
      stats.disagreed += 1; // some vendor had a dominant colour, no consensus
    } else {
      stats.weak += 1; // nothing dominant anywhere
    }
  }

  writeCharKeyedJSON(`${ROOT}/data/tags/color.json`, store);

  const byColor = {};
  for (const tags of Object.values(store)) byColor[tags[0].tag] = (byColor[tags[0].tag] || 0) + 1;

  log("COLOUR TAGS complete (vendor consensus)");
  log(`  base emojis analysed  ${bases.length}`);
  log(`  artwork found         ${SOURCES.map((s) => `${s.name} ${perVendor[s.name]}`).join(", ")}`);
  log(`  tagged (2+ vendors agree)   ${stats.tagged}`);
  log(`  dropped, Apple disagrees    ${stats.appleVeto}`);
  log(`  dropped, vendors disagree   ${stats.disagreed}`);
  log(`  dropped, no dominant hue    ${stats.weak}`);
  log(`  dropped, missing artwork    ${stats.missing}`);
  for (const key of Object.keys(byColor).sort()) log(`    ${key.padEnd(8)} ${byColor[key]}`);
  log(`  wrote                 data/tags/color.json`);
}
