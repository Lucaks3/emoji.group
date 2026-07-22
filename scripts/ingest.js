// STEP 1 · INGEST
// Load the full emojibase dataset with CLDR names, keywords, unicode versions
// and skin tone metadata, then write it to data/raw.json.

import { createRequire } from "node:module";
import { ROOT, readJSON, writeJSON, log } from "../lib/util.js";

const require = createRequire(import.meta.url);

const emojis = require("emojibase-data/en/data.json");
const messages = require("emojibase-data/en/messages.json");
const pkg = readJSON(`${ROOT}/node_modules/emojibase-data/package.json`);

// Group and subgroup labels plus stable subgroup keys (e.g. "food-fruit"),
// keyed by their numeric ids, for later reference.
const groups = {};
for (const g of messages.groups) groups[g.order] = g.message;
const subgroups = {};
const subgroupKeys = {};
for (const s of messages.subgroups) {
  subgroups[s.order] = s.message;
  subgroupKeys[s.order] = s.key;
}

const raw = {
  generator: "emoji-collections ingest",
  emojibase_version: pkg.version,
  groups,
  subgroups,
  subgroup_keys: subgroupKeys,
  emojis,
};

writeJSON(`${ROOT}/data/raw.json`, raw);

let skinCount = 0;
for (const e of emojis) if (e.skins) skinCount += e.skins.length;

log("INGEST complete");
log(`  emojibase-data     ${pkg.version}`);
log(`  base emojis        ${emojis.length}`);
log(`  skin tone variants ${skinCount}`);
log(`  groups             ${Object.keys(groups).length}`);
log(`  wrote              data/raw.json`);
