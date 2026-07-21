// STATIC SITE GENERATOR
//   npm run site
// Reads /dist and renders the emoji.group website into site/public:
//   index.html                 the landing page
//   {slug}.html                one page per collection (emoji.group/blue)
//   {slug}.json                a JSON twin so emoji.group/blue.json also works
//   emojis.json, collections/, blocklists/   the raw API, copied verbatim
//   llms.txt, robots.txt
// Plain Node, no framework. The design follows the emoji.group mockup:
// cream background, one orange accent, Instrument Sans with JetBrains Mono.

import { existsSync, rmSync, cpSync, readdirSync } from "node:fs";
import { ROOT, readJSON, writeJSON, ensureDir, log } from "../lib/util.js";
import { writeFileSync } from "node:fs";

const DIST = `${ROOT}/dist`;
const OUT = `${ROOT}/site/public`;

// Human readable copy for each facet.
const FACETS = {
  vibe: { title: "Vibe", blurb: "The feeling it gives off." },
  object: { title: "Object", blurb: "The thing it depicts." },
  domain: { title: "Domain", blurb: "The industry it belongs to." },
  color: { title: "Color", blurb: "Dominant hue, measured from the artwork. Tagged only when one hue covers 45% of the fill." },
  gender: { title: "Gender", blurb: "The gender presentation of the figure, kept per record." },
  "skin-tone": { title: "Skin tone", blurb: "Every skin tone variant is its own record, pointing at its base." },
  audience: { title: "Audience", blurb: "Derived at build time, never tagged by hand." },
  safety: { title: "Safety", blurb: "Content apps may want to exclude. Every tag is human reviewed." },
};
const FACET_ORDER = ["vibe", "object", "domain", "color", "gender", "skin-tone", "audience", "safety"];

// Swatch colours for the colour facet chips.
const SWATCH = {
  red: "#D84A3A", orange: "#E8940A", yellow: "#E0B33A", green: "#4C9A4C",
  blue: "#4A7DD8", purple: "#8B6BD8", pink: "#E86B9A", brown: "#8A5A3B",
  black: "#1B1812", white: "#DFD9CE", gray: "#9A958A",
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const LOGO = `<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="8" fill="var(--accent)"/><circle cx="9.5" cy="11.5" r="2" fill="#1B1812"/><circle cx="18.5" cy="11.5" r="2" fill="#1B1812"/><path d="M8.5 16.5c1.5 2.2 3.3 3.3 5.5 3.3s4-1.1 5.5-3.3" stroke="#1B1812" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>`;

function head(title, description) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css">
</head>
<body>`;
}

function nav() {
  return `<nav class="nav">
  <a class="brand" href="/">${LOGO}<span>emoji<i>.group</i></span></a>
  <div class="navlinks">
    <a href="/#collections">Collections</a>
    <a href="/#developers">Docs</a>
    <a href="/#safety">Safety</a>
    <a class="btn dark" href="/emojis.json">Get the data</a>
  </div>
</nav>`;
}

function footer(meta) {
  return `<footer class="footer">
  <div class="footcol brandcol">
    <a class="brand" href="/">${LOGO}<span>emoji<i>.group</i></span></a>
    <p class="muted">The emoji database, curated.</p>
    <p class="faint">© 2026 emoji.group · v${esc(meta.version)}</p>
  </div>
  <div class="footcol">
    <h4>Data</h4>
    <a href="/emojis.json">emojis.json</a>
    <a href="/#collections">Collections</a>
    <a href="/blocklists/index.json">Blocklists</a>
  </div>
  <div class="footcol">
    <h4>Resources</h4>
    <a href="/#developers">Docs</a>
    <a href="/collections/index.json">Index</a>
    <a href="/llms.txt">llms.txt</a>
  </div>
</footer>`;
}

function pageEnd() {
  return `</body>\n</html>\n`;
}

function chip(col) {
  const sample = col.emojis.slice(0, 3).join("");
  const sw = col.facet === "color" && SWATCH[col.slug]
    ? `<span class="sw" style="background:${SWATCH[col.slug]}"></span>`
    : `<span class="chipglyph">${sample}</span>`;
  return `<a class="chip" href="/${esc(col.slug)}">${sw}<span class="chiptag">${esc(col.title)}</span><span class="chipcount">${col.count}</span></a>`;
}

// ---------------------------------------------------------------------------
function buildLanding(meta, index, sampleByFacet) {
  const facetsPresent = FACET_ORDER.filter((f) => sampleByFacet[f]);
  const cards = facetsPresent
    .map((facet) => {
      const info = FACETS[facet];
      const chips = sampleByFacet[facet].map(chip).join("\n        ");
      return `<article class="fcard">
      <div class="ftitle">${esc(info.title)}</div>
      <div class="fblurb">${esc(info.blurb)}</div>
      <div class="chips">
        ${chips}
      </div>
    </article>`;
    })
    .join("\n    ");

  // Pick a collection with recognisable, colourful sample emoji for the example.
  const preferred = ["green", "red", "blue", "yellow", "purple", "pink"];
  const example =
    preferred.map((slug) => index.collections.find((c) => c.slug === slug)).find(Boolean) ||
    index.collections.find((c) => c.facet === "color") ||
    index.collections[0];
  const exampleCol = example ? readJSON(`${DIST}/collections/${example.slug}.json`) : null;
  const exampleJson = exampleCol
    ? JSON.stringify(
        { ...exampleCol, emojis: exampleCol.emojis.slice(0, 9).concat(exampleCol.count > 9 ? ["…"] : []) },
        null,
        2,
      )
    : "{}";

  return (
    head("emoji.group · the emoji database, curated", "Hand reviewed emoji collections, skin tone and gender variants, and safety blocklists. Static JSON on a CDN, one GET away.") +
    nav() +
    `
<header class="hero">
  <div class="badge"><span class="dot"></span> v${esc(meta.version)} · ${meta.emojis.toLocaleString("en-US")} emojis · ${meta.collections} collections</div>
  <h1>The emoji database, curated</h1>
  <p class="lede">Skin tone and gender variants as first class records, colours measured from the artwork, and safety blocklists a human signed off on. Static JSON on a CDN, one GET away.</p>
  <div class="herobtns">
    <a class="btn dark" href="#collections">Browse collections</a>
    <a class="btn ghost" href="#developers">Read the docs →</a>
  </div>
</header>

<section id="collections" class="section">
  <div class="kicker">COLLECTIONS</div>
  <h2>Sorted by how people actually use them</h2>
  <div class="fgrid">
    ${cards}
  </div>
</section>

<section id="developers" class="section">
  <div class="kicker">DEVELOPERS</div>
  <h2>No SDK. No API key. Just JSON.</h2>
  <div class="code">
    <div class="codebar"><span class="get">GET</span> <span class="url">https://emoji.group/collections/${esc(example ? example.slug : "index")}.json</span></div>
    <pre>${esc(exampleJson)}</pre>
  </div>
  <div class="cards3">
    <div class="mini"><h3>Deterministic</h3><p>Same input, same output. Stable codepoint order, byte for byte reproducible builds.</p></div>
    <div class="mini"><h3>Versioned by date</h3><p>Pin a build and nothing changes underneath you. Upgrade when you choose.</p></div>
    <div class="mini"><h3>Cache forever</h3><p>Static files on a CDN. Ship it to the client, bundle it, or mirror the whole thing.</p></div>
  </div>
</section>

<section id="safety" class="section">
  <div class="kicker">SAFETY</div>
  <h2>Blocklists a human signed off on</h2>
  <p class="lede center">Suggestive, violent, substances, gambling. Every safety tag passes three gates before it ships, and the build fails if one hasn't.</p>
  <div class="cards3">
    <div class="mini step"><span class="stepno">STEP 1</span><h3>Programmatic pass</h3><p>Codepoints, ZWJ sequences and artwork analysis tag everything a rule can prove.</p></div>
    <div class="mini step"><span class="stepno">STEP 2</span><h3>Model proposals</h3><p>An LLM tags against a closed vocabulary with a confidence score. It can propose, never publish.</p></div>
    <div class="mini step"><span class="stepno">STEP 3</span><h3>Human review</h3><p>A person approves every safety tag. The compiler rejects any a human hasn't seen.</p></div>
  </div>
  <div class="kidsafe">
    <span class="kidglyph">🧒</span>
    <p><b>Kid-safe is derived, not tagged.</b> It is everything minus the safety blocklists, computed at build time, so it can never drift out of sync.</p>
    <span class="kidmeta">blocklists/*.json · mode: "exclude"</span>
  </div>
</section>

<section class="section">
  <div class="manifesto">
    <div class="mtitle">We want emoji to be boring.</div>
    <div class="mbody">
      <p>Every app rebuilds the same lists. Which emojis are food. Which are safe for kids. Which ones are actually purple. Then Unicode ships a new version, and the lists quietly rot.</p>
      <p>emoji.group is that work done once, in the open: deterministic builds, human reviewed safety tags, and static JSON that will still resolve in ten years.</p>
      <p>Pin a version and forget about us. That is the point.</p>
    </div>
    <div class="sig">· the emoji.group team 🫶</div>
  </div>
</section>

<section class="section cta">
  <div class="ctatitle">Start with one GET</div>
  <div class="terminal"><span class="prompt">$</span> curl https://emoji.group/collections/index.json<span class="cursor">▌</span></div>
</section>
` +
    footer(meta) +
    pageEnd()
  );
}

// ---------------------------------------------------------------------------
function buildCollection(meta, col) {
  const info = FACETS[col.facet] || { title: col.facet, blurb: "" };
  const grid = col.emojis
    .map((c) => `<button class="ecell" title="Copy ${esc(c)}" data-c="${esc(c)}">${c}</button>`)
    .join("");
  const modeBadge =
    col.mode === "exclude"
      ? `<span class="pill warn">exclude mode</span>`
      : `<span class="pill ok">include mode</span>`;

  return (
    head(`${col.title} · emoji.group`, `The ${col.title.toLowerCase()} emoji collection. ${col.count} emojis, ${col.facet} facet. Static JSON, one GET away.`) +
    nav() +
    `
<main class="detail">
  <div class="crumbs"><a href="/">emoji.group</a> <span>/</span> <span class="cur">${esc(col.slug)}</span></div>
  <div class="dhead">
    <div>
      <div class="kicker">${esc(col.facet.toUpperCase())}</div>
      <h1>${esc(col.title)}</h1>
      <p class="muted">${esc(info.blurb)}</p>
    </div>
    <div class="dmeta">
      ${modeBadge}
      <span class="pill">${col.count} emojis</span>
      <span class="pill">v${esc(col.version)}</span>
    </div>
  </div>
  <div class="dactions">
    <button class="btn dark" id="copyall">Copy all ${col.count}</button>
    <a class="btn ghost" href="/${esc(col.slug)}.json">View JSON →</a>
  </div>
  <div class="egrid">${grid}</div>
</main>
` +
    footer(meta) +
    `<div class="toast" id="toast">Copied</div>
<script>
  const toast = document.getElementById('toast');
  let t;
  function flash(msg){ toast.textContent = msg; toast.classList.add('show'); clearTimeout(t); t = setTimeout(()=>toast.classList.remove('show'),1100); }
  async function copy(text, label){ try{ await navigator.clipboard.writeText(text); flash(label); }catch{ flash('Copy failed'); } }
  document.querySelectorAll('.ecell').forEach(b => b.addEventListener('click', () => copy(b.dataset.c, 'Copied ' + b.dataset.c)));
  document.getElementById('copyall').addEventListener('click', () => copy(${JSON.stringify(col.emojis.join(" "))}, 'Copied all ${col.count}'));
</script>
` +
    pageEnd()
  );
}

// ---------------------------------------------------------------------------
function styles() {
  return `:root{
  --accent:#E8940A;--bg:#FAF9F7;--ink:#1B1812;--muted:#6B6558;--muted2:#4A463D;
  --faint:#A39D8E;--faint2:#8A8578;--line:#E7E2D8;--line2:#F0EBE1;--card:#fff;--card2:#FCFBF8;
  --ok:#2F7A4D;--okbg:#EAF3EC;--warn:#96690B;--warnbg:#F7EEDA;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font-family:'Instrument Sans',system-ui,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.5}
a{color:color-mix(in oklab,var(--accent),var(--ink) 35%);text-decoration:none}
a:hover{color:var(--ink)}
::selection{background:color-mix(in oklab,var(--accent),#fff 65%)}
h1,h2,h3,h4{margin:0}
.mono,.kicker,.badge,.pill,.get,.url,.terminal,.chip,.chipcount,.stepno,.sig,.kidmeta,.crumbs,.dmeta .pill{font-family:'JetBrains Mono',monospace}

.nav{max-width:1120px;margin:0 auto;padding:18px 32px;display:flex;align-items:center;justify-content:space-between}
.brand{display:flex;align-items:center;gap:10px;color:var(--ink);font-size:17px;font-weight:700;letter-spacing:-0.02em}
.brand i{font-weight:400;font-style:normal;color:var(--faint2)}
.navlinks{display:flex;align-items:center;gap:6px}
.navlinks a{font-size:13.5px;font-weight:500;color:var(--muted2);padding:7px 12px;border-radius:7px}
.navlinks a:hover{background:var(--line2);color:var(--ink)}
.btn{display:inline-block;font-weight:600;border-radius:8px;cursor:pointer;border:1px solid transparent;font-size:13.5px}
.btn.dark{background:var(--ink);color:var(--bg);padding:8px 16px}
.btn.dark:hover{background:#3A362C;color:var(--bg)}
.btn.ghost{color:color-mix(in oklab,var(--accent),var(--ink) 35%)}
.navlinks .btn.dark{margin-left:6px}

.hero{max-width:820px;margin:0 auto;padding:60px 32px 0;text-align:center}
.badge{display:inline-flex;align-items:center;gap:8px;font-size:11.5px;font-weight:500;color:var(--muted);border:1px solid var(--line);background:var(--card);border-radius:999px;padding:6px 14px}
.dot{width:7px;height:7px;border-radius:50%;background:var(--accent);display:inline-block}
.hero h1{font-size:56px;font-weight:650;letter-spacing:-0.035em;line-height:1.05;margin:26px auto 18px;max-width:720px;text-wrap:balance}
.lede{font-size:17px;line-height:1.55;color:var(--muted);max-width:540px;margin:0 auto 30px;text-wrap:pretty}
.lede.center{margin-inline:auto}
.herobtns{display:flex;justify-content:center;align-items:center;gap:18px}
.herobtns .btn.dark{font-size:14.5px;padding:12px 22px;border-radius:9px}

.section{max-width:1120px;margin:0 auto;padding:100px 32px 0}
.section.cta{text-align:center;padding-bottom:20px}
.kicker{font-size:11.5px;font-weight:600;letter-spacing:0.1em;color:color-mix(in oklab,var(--accent),var(--ink) 25%);text-align:center}
.section > h2{font-size:34px;font-weight:650;letter-spacing:-0.025em;margin:12px 0 46px;text-align:center}

.fgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.fcard{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:22px}
.ftitle{font-size:15px;font-weight:650;margin-bottom:4px}
.fblurb{font-size:13px;color:var(--faint2);margin-bottom:16px;text-wrap:pretty}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);border-radius:999px;padding:5px 11px;font-size:12px;color:var(--ink)}
.chip:hover{border-color:var(--accent);color:var(--ink)}
.chipglyph{font-size:13px;letter-spacing:1px}
.sw{width:9px;height:9px;border-radius:50%;display:inline-block;border:1px solid rgba(0,0,0,.08)}
.chipcount{color:var(--faint)}

.code{max-width:860px;margin:0 auto;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;text-align:left}
.codebar{display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid var(--line2);background:var(--card2);font-size:12.5px}
.get{font-size:10.5px;font-weight:600;color:var(--ok);background:var(--okbg);border-radius:5px;padding:3px 8px}
.url{color:var(--muted2)}
.code pre{margin:0;padding:18px 22px;font-family:'JetBrains Mono',monospace;font-size:12.5px;line-height:1.7;color:var(--muted2);overflow-x:auto}
.cards3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;max-width:980px;margin:14px auto 0}
.mini{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px}
.mini h3{font-size:14px;font-weight:650;margin-bottom:5px}
.mini p{font-size:13px;line-height:1.5;color:var(--faint2);margin:0}
.step .stepno{font-size:11px;font-weight:600;color:color-mix(in oklab,var(--accent),var(--ink) 25%);display:block;margin-bottom:10px}

.kidsafe{max-width:980px;margin:14px auto 0;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 22px;display:flex;align-items:center;gap:14px;text-align:left}
.kidglyph{font-size:22px}
.kidsafe p{font-size:13.5px;line-height:1.5;color:var(--muted);margin:0}
.kidsafe b{color:var(--ink)}
.kidmeta{margin-left:auto;font-size:11.5px;color:var(--faint);white-space:nowrap}

.manifesto{max-width:860px;margin:0 auto;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:44px 48px}
.mtitle{font-size:18px;font-weight:650;margin-bottom:18px}
.mbody{font-size:14.5px;line-height:1.7;color:var(--muted2);max-width:560px;display:flex;flex-direction:column;gap:14px}
.mbody p{margin:0}
.sig{margin-top:26px;font-size:12.5px;color:var(--faint2)}

.cta .ctatitle{font-size:26px;font-weight:650;letter-spacing:-0.02em;margin-bottom:22px}
.terminal{display:inline-flex;align-items:center;gap:12px;background:var(--ink);border-radius:10px;padding:14px 20px;font-size:13px;color:var(--bg)}
.terminal .prompt{color:var(--faint2)}
.terminal .cursor{color:var(--accent)}

.footer{max-width:1120px;margin:80px auto 0;padding:44px 32px 52px;display:flex;gap:60px;flex-wrap:wrap;border-top:1px solid var(--line)}
.footcol{display:flex;flex-direction:column;gap:9px;font-size:13px}
.footcol h4{font-weight:650;font-size:12.5px;margin-bottom:3px}
.footcol a{color:var(--muted)}
.brandcol{flex:1;min-width:220px}
.muted{color:var(--muted)}.faint{color:var(--faint)}
.brandcol .muted{font-size:13px;margin:10px 0 0}
.brandcol .faint{font-size:12px;margin:20px 0 0}

/* collection detail */
.detail{max-width:1120px;margin:0 auto;padding:32px}
.crumbs{font-size:12px;color:var(--faint);margin-bottom:22px}
.crumbs a{color:var(--muted)}.crumbs .cur{color:var(--ink)}
.dhead{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;flex-wrap:wrap}
.dhead .kicker{text-align:left}
.dhead h1{font-size:38px;font-weight:650;letter-spacing:-0.03em;margin:8px 0 6px}
.dmeta{display:flex;gap:8px;flex-wrap:wrap}
.pill{font-size:11px;font-weight:600;color:var(--muted);background:var(--card);border:1px solid var(--line);border-radius:6px;padding:5px 10px}
.pill.ok{color:var(--ok);background:var(--okbg);border-color:transparent}
.pill.warn{color:var(--warn);background:var(--warnbg);border-color:transparent}
.dactions{display:flex;gap:12px;margin:24px 0}
.egrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(52px,1fr));gap:6px}
.ecell{font-size:26px;line-height:1;padding:12px 0;background:var(--card);border:1px solid var(--line);border-radius:9px;cursor:pointer;transition:transform .06s ease,border-color .1s ease}
.ecell:hover{border-color:var(--accent);transform:translateY(-2px)}
.ecell:active{transform:translateY(0)}

.toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(12px);background:var(--ink);color:var(--bg);font-size:13px;font-weight:600;padding:9px 16px;border-radius:9px;opacity:0;pointer-events:none;transition:opacity .15s ease,transform .15s ease}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}

@media (max-width:820px){
  .fgrid,.cards3{grid-template-columns:1fr}
  .hero h1{font-size:40px}
  .section > h2{font-size:26px}
  .kidsafe{flex-wrap:wrap}.kidmeta{margin-left:0}
}
`;
}

function llmsTxt(meta, index) {
  const lines = [
    "# emoji.group",
    "",
    "> A static JSON emoji API. Hand reviewed collections, skin tone and gender",
    "> variants as first class records, colours measured from the artwork, and",
    "> human reviewed safety blocklists. Deterministic, versioned by date.",
    "",
    `Version: ${meta.version}`,
    `Emojis: ${meta.emojis}`,
    `Collections: ${meta.collections}`,
    "",
    "## Data",
    "- [Full database](/emojis.json): every emoji with its tags",
    "- [Collections index](/collections/index.json): every collection with counts",
    "- [Blocklists index](/blocklists/index.json): safety collections in exclude mode",
    "",
    "## Collections",
  ];
  for (const c of index.collections) {
    lines.push(`- [${c.title}](/collections/${c.slug}.json): ${c.facet} facet, ${c.count} emojis`);
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
function run() {
  if (!existsSync(`${DIST}/index.json`)) {
    log("No /dist found. Run npm run build first.");
    process.exit(1);
  }
  if (existsSync(OUT)) rmSync(OUT, { recursive: true });
  ensureDir(OUT);

  // Copy the raw API verbatim so JSON is served from the same origin.
  cpSync(`${DIST}/emojis.json`, `${OUT}/emojis.json`);
  cpSync(`${DIST}/index.json`, `${OUT}/api.json`);
  cpSync(`${DIST}/collections`, `${OUT}/collections`, { recursive: true });
  if (existsSync(`${DIST}/blocklists`)) cpSync(`${DIST}/blocklists`, `${OUT}/blocklists`, { recursive: true });

  const meta = readJSON(`${DIST}/index.json`);
  const index = readJSON(`${DIST}/collections/index.json`);

  // Load every collection, and pick up to five sample collections per facet for
  // the landing page cards (widest ones first so the samples feel representative).
  const collections = index.collections.map((c) => readJSON(`${DIST}/collections/${c.slug}.json`));
  const byFacet = {};
  for (const c of collections) (byFacet[c.facet] ||= []).push(c);
  const sampleByFacet = {};
  for (const [facet, list] of Object.entries(byFacet)) {
    sampleByFacet[facet] = [...list].sort((a, b) => b.count - a.count).slice(0, 6);
  }

  // Landing page.
  writeFileSync(`${OUT}/index.html`, buildLanding(meta, index, sampleByFacet));

  // One page and one JSON twin per collection.
  for (const col of collections) {
    writeFileSync(`${OUT}/${col.slug}.html`, buildCollection(meta, col));
    writeJSON(`${OUT}/${col.slug}.json`, col);
  }
  // Blocklists also get a JSON twin at the root under their slug is shared with
  // the collection, so the exclude mode file lives at /blocklists/{slug}.json only.

  writeFileSync(`${OUT}/style.css`, styles());
  writeFileSync(`${OUT}/llms.txt`, llmsTxt(meta, index));
  writeFileSync(`${OUT}/robots.txt`, "User-agent: *\nAllow: /\n");

  const htmlCount = readdirSync(OUT).filter((f) => f.endsWith(".html")).length;
  log("SITE built");
  log(`  landing + ${collections.length} collection pages (${htmlCount} html files)`);
  log(`  raw API copied: emojis.json, collections/, blocklists/`);
  log(`  wrote          site/public/`);
}

run();
