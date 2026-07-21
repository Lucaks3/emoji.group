// Shared helpers for the emoji-collections pipeline.
// Everything here is deterministic: same input, same output, stable order.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Turn an emojibase hexcode ("1F44B-1F3FB") into an array of code point integers.
export function codepointsFromHex(hexcode) {
  return hexcode.split("-").map((h) => parseInt(h, 16));
}

// Compare two code point arrays lexicographically, numeric per position.
// This is the single sort order used everywhere in the pipeline.
export function compareCodepoints(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

// Sort a list of records that each carry a numeric codepoints array.
export function sortByCodepoint(records) {
  return [...records].sort((a, b) => compareCodepoints(a.codepoints, b.codepoints));
}

// Sort characters by their code point sequence (used for stable object keys).
export function compareChars(a, b) {
  return compareCodepoints([...a].map((c) => c.codePointAt(0)), [...b].map((c) => c.codePointAt(0)));
}

// Build a URL and file safe slug from a CLDR label.
export function slugify(label) {
  return label
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function ensureDir(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

export function readJSON(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// Write JSON with two space indent and a trailing newline for stable diffs.
export function writeJSON(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

// Write an object keyed by char, with keys sorted by code point order,
// so tag store files stay byte for byte reproducible.
export function writeCharKeyedJSON(path, obj) {
  const sorted = {};
  for (const key of Object.keys(obj).sort(compareChars)) sorted[key] = obj[key];
  writeJSON(path, sorted);
}

// A single tag object, in the canonical field order.
export function makeTag(tag, facet, confidence, source) {
  return { tag, facet, confidence: round(confidence), source };
}

export function round(n) {
  return Math.round(n * 1000) / 1000;
}

// Sort the tags on a record: by facet, then tag name, then source.
// Deterministic and readable in the output files.
export function sortTags(tags) {
  return [...tags].sort((a, b) => {
    if (a.facet !== b.facet) return a.facet < b.facet ? -1 : 1;
    if (a.tag !== b.tag) return a.tag < b.tag ? -1 : 1;
    return a.source < b.source ? -1 : a.source > b.source ? 1 : 0;
  });
}

export function log(...args) {
  console.log(...args);
}

// Simple ascii table for the count summaries the pipeline prints.
export function printTable(rows, headers) {
  const cols = headers.length;
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length)),
  );
  const line = (cells) => cells.map((c, i) => String(c ?? "").padEnd(widths[i])).join("  ");
  log(line(headers));
  log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) log(line(r));
}
