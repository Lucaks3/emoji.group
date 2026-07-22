// STEP 3a, 3b, 3d · PROGRAMMATIC TAGS (gender, skin tone, category, sets)
// These facets are pure code point or CLDR structure facts, so they are
// assigned deterministically and carry high confidence. Colour is heavier
// (it needs artwork) and lives in its own script, tag-color.js.
// Writes data/tags/{gender,skin-tone,category,set}.json, keyed by char.

import { ROOT, readJSON, writeCharKeyedJSON, makeTag, log } from "../lib/util.js";

const records = readJSON(`${ROOT}/data/records.json`);

// 3d. category facet: derived from CLDR subgroup keys. Base emojis only;
// the compiler inherits these to every variant, so 👍🏿 lands in gestures.
const CATEGORY_RULES = {
  flags: (sg) => sg === "flag" || sg === "country-flag" || sg === "subdivision-flag",
  faces: (sg) => sg.startsWith("face-") || sg === "cat-face" || sg === "monkey-face",
  gestures: (sg) => sg.startsWith("hand-") || sg === "hands",
  animals: (sg) => sg.startsWith("animal-"),
  weather: (sg) => sg === "sky-weather",
  zodiac: (sg) => sg === "zodiac",
  fruit: (sg) => sg === "food-fruit",
  flowers: (sg) => sg === "plant-flower",
  professions: (sg) => sg === "person-role",
  hearts: (sg) => sg === "heart",
};

// Whole Unicode groups as categories: activities (6) and symbols (8).
const GROUP_CATEGORIES = { 6: "activities", 8: "symbols" };

// Curated sets, maintained by hand and therefore source "human". Reactions is
// the canon that chat apps rebuild: default pickers and tapbacks across
// Slack, iMessage, GitHub, Discord and friends.
const CURATED_SETS = {
  reactions: [
    "👍", "👎", "❤️", "😂", "🤣", "😄", "😊", "😉", "😮", "😕",
    "😢", "😭", "😡", "🎉", "🙏", "👏", "🔥", "💯", "😍", "🤔",
    "👀", "🙌", "🚀", "✅", "❌", "💀", "🥳", "😅",
  ],
  // Only fun stuff, picked for kids: play, space, animals, fruit, party.
  // Deliberately no couples, no geometric shapes, no money, no abstract
  // symbols, and nothing that appears in a safety blocklist.
  fun: [
    "⚽", "🏀", "🏈", "⚾", "🎾", "🏐", "🏓", "🏸", "🥏", "🎳",
    "🛹", "🛼", "⛸️", "🪁", "🎯", "🎮", "🕹️", "🧩", "🪀", "🧸",
    "🪅", "🪆", "🎪", "🎠", "🎡", "🎢", "🎨", "🎭", "🪄", "🎈",
    "🎉", "🎊", "🎁", "🥳", "😄", "😆", "🤪", "😝", "🤩", "😎",
    "🌙", "⭐", "🌟", "✨", "🌈", "☀️", "🪐", "🚀", "🛸", "🌠",
    "🐶", "🐱", "🐼", "🐨", "🦁", "🐯", "🦄", "🐸", "🐧", "🦋",
    "🐢", "🐬", "🐳", "🦕", "🦖", "🐙", "🦜", "🦩", "🐿️", "🦔",
    "🍉", "🍓", "🍒", "🍍", "🍌", "🍎", "🥝", "🍇", "🍭", "🍦",
    "🧁", "🍿", "🍩", "🍪", "🎂", "🍕", "🚂", "🚲", "🛴", "⛵",
    "🏖️", "🏰", "🫧", "🪩", "🥇", "🏆", "🎵", "🎶", "🥁", "🎸",
    "🌻", "🌸", "🌺", "🍀",
  ],
  "check-marks": ["✅", "✔️", "☑️"],
};

const genderStore = {};
const skinStore = {};
const categoryStore = {};
const setStore = {};

let mixedTone = 0;

for (const r of records) {
  // 3a. gender facet. Stays per record, never inherited.
  if (r.gender) {
    genderStore[r.char] = [makeTag(r.gender, "gender", r._genderConfidence, "programmatic")];
  }

  // 3b. skin tone facet.
  const skinTags = [];
  if (r._hasSkins) {
    // A base that offers skin tones is tagged skin-tone-default.
    skinTags.push(makeTag("skin-tone-default", "skin-tone", 1, "programmatic"));
  }
  if (typeof r.skin_tone === "number") {
    skinTags.push(makeTag(`skin-tone-${r.skin_tone}`, "skin-tone", 1, "programmatic"));
  } else if (Array.isArray(r.skin_tone)) {
    // Mixed multi person tones do not map to a single 1 to 5 bucket, so they
    // stay queryable as records but get no single skin tone tag.
    mixedTone += 1;
  }
  if (skinTags.length) skinStore[r.char] = skinTags;

  // 3d. category facet, base emojis only.
  if (r.base === null) {
    const cats = [];
    if (r._subgroup) {
      for (const [tag, match] of Object.entries(CATEGORY_RULES)) {
        if (match(r._subgroup)) cats.push(makeTag(tag, "category", 1, "programmatic"));
      }
    }
    if (GROUP_CATEGORIES[r._group]) {
      cats.push(makeTag(GROUP_CATEGORIES[r._group], "category", 1, "programmatic"));
    }
    if (cats.length) categoryStore[r.char] = cats;
  }
}

// Curated sets, resolved against the dataset with FE0F tolerance so the lists
// can never silently miss the canonical spelling.
const baseChars = new Set(records.filter((r) => r.base === null).map((r) => r.char));
function resolveChar(char) {
  if (baseChars.has(char)) return char;
  const plus = `${char}️`;
  if (baseChars.has(plus)) return plus;
  const minus = char.replace(/️$/u, "");
  if (baseChars.has(minus)) return minus;
  throw new Error(`curated set references unknown base emoji: ${JSON.stringify(char)}`);
}
for (const [tag, chars] of Object.entries(CURATED_SETS)) {
  for (const char of chars) {
    const key = resolveChar(char);
    (setStore[key] ||= []).push(makeTag(tag, "set", 1, "human"));
  }
}

writeCharKeyedJSON(`${ROOT}/data/tags/gender.json`, genderStore);
writeCharKeyedJSON(`${ROOT}/data/tags/skin-tone.json`, skinStore);
writeCharKeyedJSON(`${ROOT}/data/tags/category.json`, categoryStore);
writeCharKeyedJSON(`${ROOT}/data/tags/set.json`, setStore);

// Counts for the summary.
const byGender = { male: 0, female: 0, neutral: 0 };
for (const tags of Object.values(genderStore)) byGender[tags[0].tag] += 1;
const byTone = {};
for (const tags of Object.values(skinStore)) {
  for (const t of tags) byTone[t.tag] = (byTone[t.tag] || 0) + 1;
}

const byCategory = {};
for (const tags of Object.values(categoryStore)) {
  for (const t of tags) byCategory[t.tag] = (byCategory[t.tag] || 0) + 1;
}

log("PROGRAMMATIC TAGS complete (gender, skin-tone, category, set)");
log(`  gender records   ${Object.keys(genderStore).length}`);
log(`    male ${byGender.male}   female ${byGender.female}   neutral ${byGender.neutral}`);
log(`  skin tone tags`);
for (const key of Object.keys(byTone).sort()) log(`    ${key.padEnd(18)} ${byTone[key]}`);
log(`  mixed tone combos (no single tag)  ${mixedTone}`);
log(`  category tags (bases only, variants inherit)`);
for (const key of Object.keys(byCategory).sort()) log(`    ${key.padEnd(12)} ${byCategory[key]}`);
log(`  curated sets     ${Object.entries(CURATED_SETS).map(([t, l]) => `${t} ${l.length}`).join(", ")}`);
log(`  wrote            data/tags/{gender,skin-tone,category,set}.json`);
