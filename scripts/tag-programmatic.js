// STEP 3a, 3b · PROGRAMMATIC TAGS (gender and skin tone)
// These facets are pure code point facts, so they are assigned per record and
// carry high confidence. Colour is heavier (it needs artwork) and lives in its
// own script, tag-color.js.
// Writes data/tags/gender.json and data/tags/skin-tone.json, keyed by char.

import { ROOT, readJSON, writeCharKeyedJSON, makeTag, log } from "../lib/util.js";

const records = readJSON(`${ROOT}/data/records.json`);

const genderStore = {};
const skinStore = {};

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
}

writeCharKeyedJSON(`${ROOT}/data/tags/gender.json`, genderStore);
writeCharKeyedJSON(`${ROOT}/data/tags/skin-tone.json`, skinStore);

// Counts for the summary.
const byGender = { male: 0, female: 0, neutral: 0 };
for (const tags of Object.values(genderStore)) byGender[tags[0].tag] += 1;
const byTone = {};
for (const tags of Object.values(skinStore)) {
  for (const t of tags) byTone[t.tag] = (byTone[t.tag] || 0) + 1;
}

log("PROGRAMMATIC TAGS complete (gender, skin-tone)");
log(`  gender records   ${Object.keys(genderStore).length}`);
log(`    male ${byGender.male}   female ${byGender.female}   neutral ${byGender.neutral}`);
log(`  skin tone tags`);
for (const key of Object.keys(byTone).sort()) log(`    ${key.padEnd(18)} ${byTone[key]}`);
log(`  mixed tone combos (no single tag)  ${mixedTone}`);
log(`  wrote            data/tags/gender.json, data/tags/skin-tone.json`);
