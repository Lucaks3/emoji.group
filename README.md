# emoji.group

A data pipeline that produces a static JSON emoji API, plus the website that
renders it. Every skin tone and gender variant is its own queryable record, so
`👍🏿` is directly addressable, while the LLM only ever sees base emojis and the
variants inherit their tags. That keeps quality up and token cost down.

The whole thing is deterministic: same input, same output, stable codepoint
order everywhere. No em-dashes anywhere in the code or data, by house rule.

## The data model

Emoji record:

```json
{
  "char": "👋🏿",
  "name": "waving hand: dark skin tone",
  "slug": "waving-hand-dark-skin-tone",
  "codepoints": [128075, 127999],
  "unicode_version": "1.0",
  "base": "👋",
  "skin_tone": 5,
  "gender": null,
  "tags": [ { "tag": "skin-tone-5", "facet": "skin-tone", "confidence": 1, "source": "programmatic" } ]
}
```

Collection record:

```json
{ "slug": "blue", "title": "Blue", "facet": "color", "mode": "include",
  "emojis": ["🫐", "💙", "🧊"], "count": 3, "version": "2026-07-21" }
```

## Pipeline

Each step is a standalone npm script. `npm run pipeline` runs the offline
chain (ingest, expand, programmatic tags, build, check) end to end.

| Step | Command | What it does |
|---|---|---|
| 1. Ingest | `npm run ingest` | Load emojibase-data into `data/raw.json`. |
| 2. Expand | `npm run expand` | Every skin tone and gender variant becomes its own record with a `base` pointer. Writes `data/records.json`. |
| 3a/b. Programmatic | `npm run tag:programmatic` | Gender (from ZWJ sequences and person components) and skin tone tags. |
| 3c. Colour | `npm run tag:color` | Rasterise each Twemoji SVG, measure the dominant hue by filled area, tag a colour only when it covers 45% or more. Caches SVGs in `.cache/`. |
| 4. LLM tags | `npm run tag -- --facet=safety` | Batch base emojis (40 per request) against the closed vocabulary in `prompts/facet-{name}.txt`, validate, retry once, write `data/llm/{facet}.json`. Idempotent. Use `--dry-run` to try it without an API key. |
| 6. Review | `npm run review` | Local web grid to approve or reject proposed tags. Approvals set source to `human`, rejections drop the tag. |
| 5+7. Build | `npm run build` | Apply inheritance and review decisions, emit `/dist`. Fails if any safety tag is still `source: llm`. |
| 8. Verify | `npm run check` | JSON schema validation of `/dist`, duplicate detection, coverage report. |
| Site | `npm run site` | Render `/dist` into `site/public/` (landing page plus one page per collection). |

### Colour and inheritance

Base emojis carry the colour measured from their artwork. Colour is inherited by
gender variants but **not** by skin tone variants, because the skin tone changes
the artwork the hue was measured from. A dark thumbs up is not "yellow" just
because the base is. Vibe, object, domain and safety tags inherit to every
variant; gender and skin tone are assigned per record.

### Safety

Safety tags pass three gates: a programmatic pass, an LLM proposal, and a human
review. The build refuses to ship a safety tag a human has not approved.
`kid-safe` is derived at build time as everything minus the safety blocklists,
so it can never drift out of sync.

## LLM tagging setup

Copy `.env.example` to `.env` and add your Anthropic API key. The harness
defaults to `claude-opus-4-8`. Start with the safety facet: it is the smallest,
the most valuable, and reviewing it end to end tells you whether the confidence
thresholds feel right before spending tokens on the domain facets.

```sh
npm run tag -- --facet=safety   # propose
npm run review                  # a human approves or rejects
npm run build                   # folds decisions into /dist
```

## Output

```
dist/emojis.json                full database
dist/collections/index.json     every collection with counts
dist/collections/{slug}.json    one collection (mode include)
dist/blocklists/index.json      every safety blocklist
dist/blocklists/{slug}.json     one safety blocklist (mode exclude)
dist/index.json                 build manifest
```

## Website

`npm run site` renders the static site. On Vercel (see `vercel.json`) clean URLs
serve `emoji.group/blue` as a page and `emoji.group/blue.json` as the data, and a
request to `emoji.group/blue` with `Accept: application/json` is rewritten to the
JSON. The same URL serves both audiences.

## Versioning

Builds are dated by the `VERSION` file rather than the wall clock, so a rebuild
is byte for byte reproducible. Bump `VERSION` to cut a new dated release.
