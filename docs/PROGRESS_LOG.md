# ClayOS — Progress Log

> **Living document.** Append a dated entry at the end of each working session.
> Newest first. Keep entries short: what changed, what was verified, what's next.

---

## 2026-07-15 — Session 9 (Fable 5): mobile-audit response — LIVE

**Context.** Second external audit, this time at 400×768/DPR2. It confirmed the session-8 fixes
live (title, currency, skip link, slider labels, no overflow) and flagged mobile-specific issues.
Its one stale claim — "desktop 2D story still broken" — was already fixed in session 8 (same code
path serves both; the jump-chips + sideways scroll the auditor praised on mobile IS that fix).

**Critical — 3D at ~6 fps on phones (it's the landing view):** added a **mobile perf budget**
(`MOBILE_PERF`: <768px or coarse-pointer <1024px) in `Lifecycle3DView`:
- **lite quality defaults ON** (no bloom, no flow particles, lower node resolution) — full stays one tap away;
- **DPR clamped to 1.25** on mobile (was ≤2) — fill rate dominates phone GPUs;
- **child dots sampled to ~1,800 total** across globes — heat + globe radii still computed from the
  FULL kid set, so sizes/orbits stay data-true, only dot density drops (links/particles drop with them);
- **label sprites capped at 20** (was 48);
- **flow panel starts collapsed** into a "Flow · N moved ▸" chip (it covered most of a phone canvas
  and the KPI strip).

**High/medium:**
- **Touch targets:** nav tabs/mode toggles/BU select/⚙/? at ≥40–44px on `max-md`; AskDock input/send/
  hide/pill bumped; drawer + jump-chip buttons padded; **sliders 3px → 24px hit area** under
  `(pointer: coarse)`.
- **Ask-bar clearance:** Data + Analytics bottom padding → `pb-24` on mobile (96px measured).
- **Network legibility on phones:** `labelRenderedSizeThreshold` 8→14 + `labelDensity` 0.5 +
  bigger label grid when the container is <640px — labels appear as you zoom instead of soup.
- **2D story on phones:** rail was squeezing the story to ~160px — ported the ☰ drawer pattern from
  GraphView (fixed drawer + backdrop + bottom-sheet detail rail); story now full-width (390px measured).
- **Data table affordance:** mobile-only right-edge gradient cue that disappears at scroll end.
- **hashchange routing (audit #8):** direct hash edits after load now re-route (listener applies
  tab/ontoMode/focus/hl; our own `replaceState` never fires it, so no loop).

**Verified:** new mobile suite **16/16** at 390×844 (lite default, collapsed flow chip, drawer,
full-width story, hash routing, fade cue, 44px targets, 96px clearance, 0 page errors) + desktop
regression suite 18/19 (same software-GL stall-threshold artifact as session 8; isolated probes
~800ms). Deployed; prod cache-busted check shows `index-BXg7hpwi.js`.

**Not done (accepted for POC):** compacter mobile header / hamburger nav (audit L7) — touch-target
bumps made the header taller if anything; revisit only if John cares about phone ergonomics beyond
demo-grade. True mobile FPS could not be measured headless (software GL) — the budget cuts geometry
~3.4×, fill ~2.5×, and removes bloom/particles, but **ask John to sanity-check on a real phone**.

---

## 2026-07-15 — Session 8 (Fable 5): external site-audit response — LIVE

**Context.** John handed over a detailed external audit of clayos.pages.dev (2 critical, 3 high,
3 medium, 3 low + polish). Everything actionable fixed in one pass and shipped live.

**Critical fixes:**
- **2D story unusable at 200 projects** — root cause corrected vs the audit: not overflow clipping
  but `preserveAspectRatio="meet"` fit-scaling a 31.7k-unit-wide viewBox to ~4% (a sliver). Now
  renders height-locked at readable scale inside an `overflow-x-auto` scroller (min-width = container
  → small/filtered portfolios still fit like before), with stage **jump-to chips** + keyboard-scrollable
  container. Verified: svg 26,757×843px, 6,000 circles, 15px labels, 4 stage chips.
- **Network view froze the main thread** — the synchronous `forceAtlas2.assign` (120 iters × 6k nodes)
  is now the **FA2 web-worker supervisor** (`graphology-layout-forceatlas2/worker`, `inferSettings`),
  circular seed, "settling layout…" badge, stop timer ~6s, kill on unmount. Bonus hardening: Sigma
  creation waits a frame until the container has width (kills a "Container has no width" race on
  fast tab transitions) + `allowInvalidContainer`. Verified: max main-thread stall ~750–870ms on
  **software** WebGL (real GPUs far lower) vs >5s deterministic lock before.

**High/medium/low:**
- **Semantic headings** (audit had zero h1–h6 right): h1 Clayco → h2 sections/view titles → h3
  cards/rails, styling unchanged (Tailwind preflight makes headings inherit).
- **Form labels**: `Field` in both ontology rails is now a real `<label>` wrapper; the 4 flow-panel
  sliders got `aria-label`s; lite/drift toggles got `aria-label` + `aria-pressed`.
- **Currency**: shared `lib/format.js fmtMoney` ($92.2B / $421M / $87K tiers) replaces three
  divergent per-view `fmt$`s — no more `$92171.5M`.
- **Chat dock**: fully-minimizable to a ✦ pill (persisted `clayos.ask.min`; chart "✦ ask" un-minimizes);
  Data/Analytics got bottom scroll clearance so last rows/charts clear the dock.
- **Colorblind palette now reaches charts**: semantic chart colors (`chartColor()` in palette.js —
  CPI/SPI good/bad, BAC/EAC, WIP over/under, RFI, TRIR, trend lines) swap to Okabe-Ito pairs with the
  pref; `prefers-contrast: more` auto-enables higher-contrast when no stored pref.
- **Meta**: description + OG + twitter card + theme-color + **robots noindex** (POC wearing a real
  firm's name — link previews yes, search indexing no); title "ClayOS — Clayco portfolio intelligence".
- **Skip-to-content link** + `main id`.
- **Code-splitting**: all 4 remaining views lazy — entry chunk 1.19MB → 596KB; recharts (407KB) and
  sigma/graphology (185KB) now load only when their tab opens.

**Audit claims corrected (for the record):** (a) "zero width-based breakpoints" is false — the
compiled Tailwind CSS has 8 width media queries and the session-5 phone drawers work; the auditor
likely counted runtime `<style>` tags only. Verified again: no page-level horizontal overflow at
390px. (b) "8 of 10 controls unlabeled" — the real gaps were the 4 sliders + rail selects, now fixed.
(c) Network "6,000 SVG nodes" — Sigma renders to WebGL canvas; the freeze was layout, not SVG.

**Verified:** headless suite 18/19 (the one miss is a stall-threshold artifact of software-GL +
teardown contention; isolated probes pass at ~800ms). 0 page errors, 0 console errors. Deployed +
prod cache-busted check: new bundle `index-CIa0aMex.js`, HTTP 200, new title/meta live.

**Gotcha discovered:** headless chromium here needs `--enable-unsafe-swiftshader` for WebGL;
`--use-gl=swiftshader` (the old flag) leaves GL disabled → the 3D view crashes into the root
ErrorBoundary and the whole app renders blank. Verify scripts should also poll for the 2D/network
views (subgraph fetch on micro can exceed 5s).

**Next:** unchanged from session 7 (pg_cron, CI deploy, RLS enable-path, kg_entity_facts cap) —
plus consider a fit/scroll toggle or minimap for the 2D story if John wants the "bell" overview back
at full-portfolio scale.

---

## 2026-07-14 — Session 7 (Fable 5): 200-project portfolio + orbital 3D layout — LIVE

**Context.** John: get the UX right at real scale — 200 projects — before Snowflake. Direction:
"expand the orbit"; left→right stays time; ball size stays data volume; **activity heat pulls a
project toward the core** (his pick); periphery **fades with distance** (his suggestion); non-project
stays below; use vertical AND depth.

**Seed (seed/generate.py):** +192 light projects (~15–30 entities each: condensed cost accounts +
latest EVM period, 1 pay app, 2 subcontracts, stage-appropriate RFIs/logs/safety) via a **separate
RNG (4242) appended after the original generation — the 8 deep projects and their goldens stay
byte-identical** (verified: Aurora CPI 0.910/SPI 0.839/TRIR 9.43). Each light project gets a
hot/warm/cold HEAT profile driving its activity dates. Names deduped (city×template collisions).
20 daily logs per light field project so TRIR denominators are sane (was 6 → one recordable = absurd
50+ TRIR). **Cloud now: 200 projects, 6,328 entities (all embedded), 7,920 history rows.**

**Orbital 3D (Lifecycle3DView):** x = lifecycle band (stage labels ride a **glowing time axis**);
radial distance = activity heat (recency-decayed per-project score from kg_entity_facts — hot hugs
the core, dormant drifts out); angle = BU sector over 292° (bottom wedge = backbone corridor);
**periphery fades** (node colors lerp toward background, membranes/labels too); labels capped to the
~48 hottest/biggest; hub size = data volume; camera frames the axis span; perf: nodeResolution 7/4,
linkOpacity 0.26, DPR clamp. subgraph limit 2000→6000 (also GraphView/LifecycleView).

**Analytics at scale (DashboardView):** per-project bar charts cap to **top 14 by the chart's own
signal** (value/open RFIs/TRIR/|WIP|), focused project always kept, "top 14 of N" noted; the
value-weighted portfolio stats still compute over the full set.

**Evals:** harness `focus` now accepts an array of acceptable codes; goldens updated for the
200-project landscape (over-budget → any of the top-5 worst Compute CPIs incl. DC-001; worst safety
→ Charlotte Distribution Hub Ph2, TRIR 17.33). **6/6 pass against live.** Verified live headless:
0 exceptions, orbit renders 200 globes + 2,178 movers, Data "of 6,328", Analytics caps active.

**Session 7 cont. (same day):** user feedback pass — **periphery-fade slider** (0→0.95, default 0.8;
live: recolors nodes + refades membranes/labels without a scene rebuild — raw heat now travels with
the objects instead of baked fade), **flow-particle size rebased** (old max 3 = new min, range 3–10),
**speed defaults to minimum** (0.001), **stage labels ~2× larger** (30px, brighter) so the axis reads
zoomed-out. Verified live headless (sliders present, fade-at-0 brightens the whole portfolio, 0 errors).

**Next:** the orbital layout is the scale testbed for Phase 4a (Snowflake, real ~200 projects). UX
ideas John may want next: cluster expand-on-zoom LOD, orbit legend/axis rings, per-BU orbit filters.

---

## 2026-07-13 — Session 6 (Fable 5): Snowflake gap assessment + semantic-layer artifact set

**Context.** John shared a trusted data map of Clayco's real warehouse (`DB_CONTROL_TOWER`:
126 dynamic tables, JDE/PMWeb/ACC/Textura/TradeTapp/SmartPM, no FKs, ~200 active projects) and asked:
gaps vs ClayOS, opportunities, and what to do before connecting. Full plan (approved):
`/home/clawd/.claude/plans/db-control-tower-data-map-robust-comet.md`.

**Key decisions (John):** Supabase is NOT Clayco-approved → **no real data in Supabase, ever**;
the ClayOS pattern gets **ported into Snowflake** instead (the POC stays synthetic). Compute
**all three EV proxies** side-by-side (cost-forecast, SmartPM schedule, billings) since the
warehouse has no true EV/PV. Pilot 10–20 projects, design for 200.

**Shipped:** `integrations/snowflake/` artifact set, authored from the assessment + faithful ports
of migrations 006/007/011 — README (verification-first workflow), 00 setup (roles/warehouse/
resource monitor/pilot config), 01 source verification (the 5 mapping questions + broken-object
and freshness assertions + Cortex probe), 02 vendor master (JDE spine + fuzzy-match thresholds
0.90/0.70 + review queue), 03 ENTITIES/EDGES dynamic tables (natural-key ids; DailyLogs deliberately
not projected), 04 KPI views (EVM×3 bases + divergence view + TRIR/field/backlog/pipeline/rollup +
reconciliation export), 05 guarded query harness (3-layer port of kg_query_safe) + Cortex Search stub.

**Honesty note:** every warehouse column is tagged `[INFERRED]` — authored without live warehouse
access. Nothing runs before 01 verifies columns and the README "Verified facts" table is filled.

**Next:** John's Phase-0 items — governance approvals (schema, Cortex, hosting), service user +
key pair, run 01, pick the pilot slate. Then I can finalize 02–05 against verified columns.

---

## 2026-07-13 — Session 5 (Fable 5): phone drawers finished + clarity/display prefs — LIVE

**Context.** Resumed an interrupted, uncommitted session: mobile-responsive edits were already applied
to 5 views, and 4 components were drafted but not wired (`HelpModal`, `Skeleton`, `glossary.js`,
`prefs.js`). Finished the wiring, verified, deployed. **Live at https://clayos.pages.dev** (bundle
`index-2ylaE86h.js`).

- **Phone drawers (session-4 deferred item, now done):** 3D + Network side rails open via a ☰ button as
  fixed drawers with backdrop; detail rails become bottom sheets on phones; Sigma + 3D canvases track
  their *container* via ResizeObserver (not just window resize) and the 3D renderer clamps DPR ≤2.
- **Per-tab help:** header "?" opens `HelpModal` for the active tab — the plain-language companion to
  the poetic `OntologyIntro`. Dashboard help copy rewritten to only promise what actually ships.
- **Skeletons:** Data table + Analytics render shimmer placeholders while loading (`Skeleton.jsx`,
  keyframes ship once via `<ShimmerStyle/>` at the app root; static under prefers-reduced-motion).
- **KPI glossary:** `defOf()` puts plain-language hover definitions (dotted underline + title) on metric
  labels in Analytics (Stat, BU backlog/pipeline/win-rate) and the 3D KPI strip.
- **Display prefs (header ⚙, persisted in `clayos.display.v1`):** colorblind-safe palette
  (`TYPE_COLOR_CB` — Okabe-Ito anchored; hue = domain family matching TYPE_SHAPE, lightness = type;
  `colorFor()` reads the active map, App remounts views on change since scenes bake colors);
  higher-contrast (CSS lifts the dim `text-white/*` tiers + hairline borders via `.cl-contrast`);
  literal labels (3D view: "Recent activity"/"updated"/"Value in slice" replace the vascular metaphor).
- **Small fixes:** 24px horizontal overflow at 390px (header BU select now `max-md:max-w-[10rem]`,
  label hidden on phones); inline SVG favicon (every prod visit 404'd before).

**Verified:** headless via **snap chromium + puppeteer-core** (the puppeteer-cache Chrome binaries
segfault on this box — use `/snap/bin/chromium` with a home-dir `userDataDir`; `networkidle2` never
fires on this app, wait on `domcontentloaded` + settle). **17/17 checks passed**: help modal open/Esc,
3 pref toggles apply (palette swaps legend colors, `.cl-contrast` on root), glossary titles present,
Data "of 1,711", literal-mode strings, phone drawers open as fixed overlays, bottom-sheet detail,
0 horizontal overflow, 0 runtime exceptions on all passes. Deployed via wrangler; prod HTTP 200 and
serving the new bundle (first curl hit stale edge cache — cache-bust before concluding a deploy failed).

**Next:** ROADMAP Phase 2.5 leftovers (CI auto-deploy, pg_cron, RLS enable-path, kg_entity_facts
pagination) + Phase 3 polish. Graph keyboard cycling + network LOD still deferred.

---

## 2026-06-29 — Session 4 (Opus 4.8): external-review response, Phase 1 LIVE

**Context.** User pasted a thorough external review of the live app (3 concrete issues + 10
improvements), approved a 4-phase plan (`/home/clawd/.claude/plans/sparkling-singing-lighthouse.md`),
chose "deploy when verified". Phase 1 = the 3 visible issues. **All LIVE at https://clayos.pages.dev.**

- **#2 Markdown answers (was raw `##`/`**`).** Added `react-markdown`+`remark-gfm`; `AskDock` renders
  assistant text via a compact dark component map (headings/bold/lists/GFM tables/code). Verified live:
  real `<strong>`/`<li>` elements, no literal markers.
- **#3 Streaming + progress (was a 12–15s static "analyzing…").** `agent-ask` now returns SSE when the
  client sends `Accept: text/event-stream`: a `tool` event per kg_* call with a friendly label
  (e.g. "pulling KPIs for Aurora"), `token` deltas via Anthropic streaming on the final turn, then a
  `done` event carrying `{focus,highlight}` (the `@@VIEW@@` marker is tail-buffered out of the visible
  text server-side). **JSON path preserved** for evals; client (`askStream` in `api.js`) has a JSON
  fallback so chat can't regress if a proxy collapses the stream. `AskDock` shows a typing indicator +
  live tool-progress line. Verified live via curl (tool/token/done all stream) and a headless chat run.
- **#1 3D `reading 'x'` crash — root-caused & fixed.** Reproduced via CDP (headless Chromium + pointer
  drags): `OrbitControls.onPointerUp` reads `_pointerPositions[id].x` on a pointer it never tracked,
  triggered when a node **drag** ends and 3d-force-graph fires a synthetic `pointerup` to stop the camera
  taking over. Fix: `.enableNodeDrag(false)` in `Lifecycle3DView` — nodes are pinned (fx/fy/fz) and the
  camera is orbit-driven, so node-drag was never wanted; this removes DragControls entirely. Verified:
  0 exceptions across aggressive drags/sliders/highlight/BU-rebuild/resize (was reproducible before).
- **Eval harness fix (pre-existing bug):** `evals/run.mjs` declared `const URL = …` which shadowed the
  global `URL` constructor → the suite never ran. Renamed to `BASE`. Now **5/6 pass**; updated the safety
  golden `9.27→9.43` (stale after the session-3 re-seed; agent + number both verified correct).

**Deployed:** edge fn (`supabase functions deploy agent-ask`) + frontend (`wrangler pages deploy`).
Prod HTTP 200, bundle `index-DBy5gEQz.js`.

**Phase 2 — ontology UX & reliability — ALSO SHIPPED LIVE (bundle `index-Cdng8Lyc.js`):**
- **B1 — 1,000-row cap (latent bug).** PostgREST caps responses at 1,000; the graph is 1,711 entities,
  so `allEntities` (Data table + quantification/CSV), `entityClassMap` (3D highlight) and `entityFacts`
  (flow/$) silently dropped ~711 rows. Added `fetchAllRows` (Range paging for tables) and `fetchAllRpc`
  (?limit/?offset paging for the SETOF RPC — it **ignores** the Range header) in `api.js`, with a
  50-page safety cap. Verified: entities 1,711 (unique), facts 1,314 (unique); Data footer now reads
  "of 1,711".
- **#4 Resizable/expandable chat.** AskDock now has a drag-to-resize grip + expand/shrink toggle; size
  persists in localStorage; transcript auto-scrolls. Verified live: 320→470px via the grip.
- **#5 Onboarding overlay.** New `OntologyIntro` — a first-run "what am I looking at?" coachmark for the
  3D metaphor (globe/pulse/vessel/click), persisted (`clayos.introSeen.v1`), with a "?" reopen button.
- **#9a 3D perf.** Added a **lite** quality mode (no bloom, no flow particles, lower node resolution) —
  manual toggle + **auto-downgrade** if the opening ~3s averages <25 fps. Verified: auto-lite fired under
  swiftshader, manual toggle back to full, both rebuilds + node-drags = 0 exceptions.

**Phase 3 — cross-cutting clarity — ALSO SHIPPED LIVE (bundle `index-Bvy78TNs.js`):**
- **#6 Global active-filter bar.** App-level bar (all tabs) showing active `focus`/`hl` as chips with
  per-chip ✕, a **Clear all**, a **scope indicator** ("1 project · highlight slice · whole portfolio"),
  and an explicit **🔗 copy link**.
- **#8 Analytics zero-states.** BU rollup cards with no projects render "— · Support group · no
  construction projects" (was "$0.0M · 0 active"); null pipeline/win-rate show "no data" + tooltips
  (vs a genuine 0).
- **#10 Export + ask + share.** Each Analytics chart has **CSV** (chart data) + **PNG** (SVG→canvas) +
  **✦ ask** (opens the chat pre-seeded with a chart-specific question and auto-sends). **Share-link**:
  "copy link" encodes `{tab,ontoMode,focus,hl}` to the hash on demand only; a shared link is applied on
  load **and surfaced in the filter bar** (never silently scoped — respects the URL-hash incident; we
  still only *auto*-persist tab/ontoMode, so a plain reload returns to full).
- Verified headless: filter bar + Clear all + copy link; 6/6 chart toolbars; zero-states; ask-about-this
  opens + streams; 0 exceptions.

**Phase 4 — accessibility & responsive — ALSO SHIPPED LIVE (bundle `index-5U-XOR2J.js`):**
- **#7 a11y + color/shape encoding.** Added `TYPE_SHAPE` (shape-by-domain-family glyphs ● ◆ ▲ ■ ⬢ ★ ▮) so
  legends + the Data type column don't rely on hue alone (CVD); Data table got `scope="col"` + `aria-sort`
  + keyboard-activatable rows (Enter) + focus rings; `aria-label`s on the BU/type/search controls;
  3D auto-drift now defaults OFF under `prefers-reduced-motion: reduce`.
- **#9b responsive/tablet.** Header wraps; detail rails capped at `max-w-[80vw]`; the Analytics grids +
  filter toolbars already reflow. Verified: no horizontal overflow at 834px (tablet) or 390px (phone).
  (Full phone nav-drawer for the 3D/graph side rails deferred — tablet is the stated target.)
- Verified headless: glyphs in legends, table ARIA, reduced-motion default-off, both viewports, 0 exceptions.

**✅ All 4 review phases complete and live** (3 issues + 10 improvements + 2 latent bugs B1/eval). Edge fn
deployed once (Phase 1); frontend deployed per phase (4×). **Deferred (noted in ROADMAP):** full phone
nav-drawer, full graph node-by-node keyboard cycling, network-graph LOD.

---

## 2026-06-29 — Session 3 (cont.): cloud re-seed LIVE + edge-block incident

- **Cloud re-seeded** with the 8-project dataset via `scripts/reseed-cloud.sh` (user said "you run it").
  Verified live via anon: 8 projects (incl. CRG-100 The Cubes, CRG-200 Chapter), CRG BU rollup ($310M /
  2 proj), enterprise $2.1B / 8 proj, 1,711 entities, 318 kpi_history rows, all embeddings drained.
- **Incident:** the live app showed all-zeros for the user. Root cause (with user's dashboard help):
  Supabase **platform abuse protection 503'd the user's browser IP at the edge** (preflight rejected
  upstream of the gateway) — triggered by the session's heavy load on the `micro` instance + the user's
  refreshes. NOT data loss / RLS / cache / key. Confirmed: Management API shows Network Restrictions open
  + zero bans; phone (different IP) loaded fine. Auto-expires.
- **Fixes shipped:** (a) `dataHealth()` + red "can't reach the data service" banner instead of silent
  zeros; (b) URL hash now persists only tab/onto-mode (was persisting focus/hl/bu → reload looked empty).
- **Follow-up noted:** `kg_entity_facts` returns ≤1,000 rows (PostgREST max-rows) — paginate/raise.
- **Lesson:** don't hammer the `micro` Supabase instance.

---

## 2026-06-28 — Session 3 (Opus 4.8): top-15 improvements + data expansion (overnight, autonomous)

**Context.** User asked to deep-dive state, list 15 improvements, then plan + execute all 15 overnight
plus add more data (incl. Clayco's development arm, CRG). Plan approved; executed in phases, shipping
incrementally (build → headless verify → wrangler deploy → commit) so the live app never broke.

**Shipped live (commits a8df2bd → f5f41ae):**
- **Phase A** — fixed Analytics Recharts (ResponsiveContainer needed `min-w-0`); surfaced unused KPI
  matviews (kpi_wip/backlog/pipeline/resource_util) as new Analytics sections; Analytics scopes to the
  focused project; Data table scopes to vendor/employee highlight (via kg_neighbors) + CSV export;
  URL-hash deep-link state; deleted dead AskView.
- **Phase C** — `kg_query` text-to-SQL tool (migration 011: `kg_query_safe`, SELECT/WITH-only, single
  statement, owned by clayos_readonly, 5s/500-row caps) + structured agent view-control (`@@VIEW@@`
  markers → focus/highlight). Deployed agent-ask. Verified live (focus DC-001; kg_query aggregate).
- **Quality** — ErrorBoundary; Data table render cap (800); `evals/` agent regression set.

**Done locally, CLOUD re-seed pending user (safety system blocked autonomous prod rebuild):**
- **Phase B** — `seed/generate.py`: CRG BU + 2 CRG projects, deepen all projects, stage-aware field
  activity, sector-aware spaces/elements, 12-month kpi_history backfill. Local verified: 6 BUs, 8
  projects, ~1,711 entities, 318 history rows; CRG EVM sane. Analytics CPI/SPI trend chart added (live,
  populates after cloud re-seed). Prepared `scripts/reseed-cloud.sh`.

**Scaffolding (local, non-breaking):** migration 012 — field/exec RLS roles + JWT-claim helper (RLS not enabled).

**Gotchas:** Recharts width-collapse = missing `min-w-0`; `SET ROLE` is illegal in SECURITY DEFINER →
own the fn as clayos_readonly (needs CREATE on schema to set owner); seed pct_complete clamped to [0,100].

**Next:** run `./scripts/reseed-cloud.sh`; then optional pg_cron/CI, RLS enforcement, semantic search,
2D/Network cross-filter, 3D-view refactor. See DECISIONS ADR-009/010/011.

---

## 2026-06-28 — Session 2 (Opus 4.8): unified 3D "vascular" ontology interface

**Context.** User reviewed the live app and steered the ontology hard toward a Palantir-AIP /
OrgMap-style **single linked-selection workspace** ("one interface for everything"), with an
ontology that "tells a story by just looking at it" and "feels like flying around interwoven
vascular systems that talk to each other."

**Did (frontend only — backend/data/agent untouched this session):**
- Reshaped the ontology through several iterations, all deployed to https://clayos.pages.dev:
  1. **2D lifecycle "story"** (`LifecycleView.jsx`, SVG): projects as data-mass mounds along the
     lifecycle; the portfolio data profile forms a bell; an enterprise-backbone lane underneath.
  2. **Cross-cutting "Highlight by" filters**: MasterFormat/CSI · UniFormat · Vendor · Employee —
     light a key across every project at once. Backed by `classification_codes` + `entities.classification_id`
     via PostgREST (no schema change). Verified: Concrete (03 00 00) lights 5–6 projects.
  3. **3D** (`Lifecycle3DView.jsx`, `3d-force-graph`+`three`): first as domain-layer towers, then per
     user direction → **floating globe-clusters in the ether** (x=lifecycle into depth, BU-tinted,
     faint membrane), all edges connected across clusters.
  4. **Unified interface**: docked **selection-driven KPI strip** (click a project → CPI/SPI/EAC/RFIs/TRIR
     rescope; verified Cedar Rapids → CPI 1.06/SPI 1.04/TRIR 4.38) + docked **Ask** box (selection context).
  5. **"Vascular" aesthetic**: thin vessels, bloom + depth fog, drifting auto-orbit, **flowing particles =
     data points that "moved" in a time-window** with window/speed/size sliders + live "N moved" count.
- Toned bloom + added label chips so text stays crisp; fixed a one-time particle init error
  (self-loop filter + `cooldownTicks(1)`); made decorative meshes non-raycastable so node clicks register.
- Verified throughout with headless-Chromium (swiftshader) screenshots + driven interactions
  (KPI rescope, flow-window gating 1h/24h/30d → 0/27/744 moved).

**Deps added:** `3d-force-graph`, `three`, `three-spritetext` (3D chunk lazy-loaded).
**Decision:** see DECISIONS ADR-008.

**Next (in progress):** enrich the flow — (1) pulse colour/speed by domain+recency + hub pulse,
(2) **real recency** from domain dates (migration 010 `kg_entity_facts()`), (3) **$-weighted vessel
thickness**. Then keep deepening the unified workspace.

---

## 2026-06-27 — Session 1 (Opus 4.8), part 3: Phase 1 LIVE (build + provision)

**Did:**
- Built edge functions: `_shared/{cors,db,embeddings,kg_tools}.ts`, `agent-ask` (Claude opus-4-8 32-turn
  tool loop, read-only kg_* tools), `embed-entities` (drain graph_embed_jobs). Consulted claude-api skill
  (model `claude-opus-4-8`, no temperature/thinking).
- Built frontend (React 19 + Vite 6 + Tailwind 4): App shell + BU filter, GraphView (Sigma+graphology
  forceAtlas2 + drill-down right rail), DashboardView (Recharts: CPI/SPI, BAC vs EAC, RFIs, TRIR + BU
  rollup strip), AskView (chat → agent-ask). Production build OK (978KB).
- **Provisioned cloud:** created Supabase project `fwaydsjpudusbaeyccjc` (us-east-2, PG17); applied all 9
  migrations + seed (750 entities/1004 edges); exposed `clayos` schema to PostgREST via mgmt API; deployed
  both edge functions + secrets; drained all 750 embeddings.
- **Verified agent end-to-end** against live cloud — grounded cited answer (Aurora CPI 0.91 / SPI 0.839 /
  EAC $396.9M / TRIR 9.27 / 19 open RFIs).
- Deployed frontend to **https://clayos.pages.dev** (Cloudflare Pages); verified HTTP 200 + anon PostgREST
  data paths (kg_bu_rollup, kpi_evm, kg_subgraph 528 nodes).
- Pushed code to **github.com/jpm72780/clayos**.

**Gotchas / decisions:**
- Seed `SET session_replication_role` removed (superuser-only on Supabase).
- PostgREST didn't know `clayos` schema → set via mgmt API PATCH (config.toml only affects local).
- Pooler host is `aws-1-us-east-2` (not aws-0); DDL needs session pooler port 5432.
- GitHub auth: gh token lacks `workflow` scope, PAT lacks repo access → workflow parked in `docs/deploy/`,
  CI not enabled, deploys via wrangler. See INFRA.md.

**Final verification:** live app HTTP 200; agent re-verified on a 2nd question type (worst safety record →
Aurora TRIR 9.27 vs Cedar Rapids 4.38, correct comparison). Docs reviewed + synced. **Session 1 ends with
Phase 1 fully live.**

**Next:** Phase 2 (browser-verify UI, enable CI + pg_cron, kg_query text-to-SQL, RLS scoping).

---

## 2026-06-27 — Session 1 (Opus 4.8), part 2: Phase 0 COMPLETE

**Did:**
- Wrote migrations **004** (35 domain tables), **005** (entities/edges + kg_traverse/kg_subgraph/
  kg_neighbors/kg_search), **006** (projection engine: project_entity/project_edges/project_to_graph,
  generic trigger on 23 tables, graph_embed_jobs, kg_reproject_all, embed-drain helpers),
  **007** (8 KPI matviews + kg_bu_rollup + kpi_history + refresh/snapshot + kg_project_kpis),
  **008** (grants + clayos_readonly role), **009** (pg_cron, guarded).
- Verified all 9 apply clean on local pgvector PG. Smoke-tested projection + traverse.
- Built `seed/generate.py` (deterministic, SQL-to-stdout, driver-free). Seeded 750 entities /
  1004 edges. Verified EVM/WIP/safety/field/rollup numbers are realistic and self-consistent.
- **Phase 0 exit criteria MET.**

**Bugs found & fixed:**
- 009: nested `$$` dollar-quote collision (DO block + inner cron strings) → renamed DO tag to `$do$`.
- `kg_project_kpis` keyed only on domain project_id; made it accept a Project entity id too.
- `scripts/db.sh reset` can't rm `.pgdata` (owned by container postgres uid) → use DROP SCHEMA.

**Verified numbers (known-good):** Aurora SPI 0.84/CPI 0.91 (over+behind), Cedar Rapids 1.04/1.06;
Aurora overbilled +$17.5M; TRIR 9.27 vs 4.38; enterprise rollup $1.79B over 6 projects.

**Next:** Phase 1 — embeddings drain, agent-ask + kg_tools, frontend (Sigma/Recharts/chat), provision.

---

## 2026-06-27 — Session 1 (Opus 4.8): planning + scaffold

**Context.** New project kicked off. User wants a "company operating system" for Clayco:
ontology/knowledge-graph viewer + reporting + KPI + agentic Q&A + (later) app builder.

**Did:**
- Ran 3 Explore agents (counterpart stack inventory, infra recon, construction-domain research)
  + 1 Plan agent. Findings drove the architecture.
- Approved plan written to `/home/clawd/.claude/plans/lets-create-a-new-breezy-curry.md`.
- User confirmed 4 decisions: synthetic seed · thin slice all 5 layers · new repo + new Supabase +
  Postgres-native graph · depth-first (3 BUs, 5-6 projects).
- Scaffolded repo at `/home/clawd/projects/clayos`: README, .gitignore, docker-compose (local
  pgvector PG @ 54329), `scripts/db.sh`.
- Wrote migrations **001** (extensions + helpers), **002** (classification), **003** (business_units).
- Designed migration **004** (all domain tables) — captured in `docs/ARCHITECTURE.md`; not yet
  committed to disk (Write interrupted).
- Created this living docs set (HANDOFF, ARCHITECTURE, PROGRESS_LOG, DECISIONS, INFRA, ROADMAP).

**Verified:** nothing run against a DB yet. No infra provisioned.

**Next:** write 004-006, start local PG, apply migrations, then 007-009 + seed. See HANDOFF "Next actions".

**Notes / gotchas discovered:**
- counterpart uses `claude-opus-4-7`/`claude-sonnet-4-6` model pins — verify current IDs via the
  claude-api skill before wiring `agent-ask` (don't copy stale pins).
- n8n API-created workflows can't resolve UI-created credentials (build in UI). Not relevant until
  ingestion phase.
- Cloudflare Pages (wrangler) rejects unicode in commit titles — keep commit messages ASCII.
