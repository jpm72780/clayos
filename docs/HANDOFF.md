# ClayOS — Handoff (read this first)

> **Living document.** Update the "Current snapshot" + "Next actions" sections at the
> end of every working session. This is the single entry point for resuming work.

**Last updated:** 2026-09-09 (session 15 — the "Clayco Time" tab: Gantt + history + EVM curves, LIVE)
**Updated by:** Claude (Fable 5) session

---

## ⚡ Session 15 — Clayco Time (read this first)
A 4th top-level tab with three modes, **live** (`verify-time.mjs` 30/30, map + analytics 13/13 each,
all against prod): **Schedule** (portfolio Gantt of 200 projects → expand for activities with
baseline / % complete / hatched float / milestones / FS logic), **History** (4,671 dated records:
stacked histogram + per-type swimlanes + detail list; drag the top band to set the range) and
**Trends** (PV/EV/AC S-curve + CPI/SPI by month). A **time range is now a third cross-cutting
filter** beside focus/hl — it scopes the Data table too, and its chip only appears on tabs that
actually consume it (`RANGE_TABS` in App.jsx).

**The data was reworked first — the old seed made a Gantt indefensible.** Uniform 60-day bars,
`is_critical` hard-coded on four *disconnected* bars of a serial chain, random float, `actual_start`
on all 88 rows including 2027-dated ones, no phase dates, one orphan pay app #6. Now the seed runs a
**real CPM** (`TRADE_DUR` + non-serial `TRADE_DEPS`, forward/backward passes) so critical path and
float are *derived*; durations scale per project; milestones, phase windows, monthly pay apps and an
S-curve `cost_progress` were added; and **all 200 projects have schedules** (1,088 rows, was 88).
Future-dated actuals: 61 → 0. **Evals stayed 6/6 through the reseed** because the S-curve and the
final pay app preserve final-period totals exactly.

**Migration 015 / ADR-016 — graph budget.** The 960 long-tail summary bars would have blown the
6,500-node client subgraph limit and silently truncated entity types (session-11 bug). So
`schedule_activities.is_summary` rows are **relational-only**: the guard lives in `_upsert_entity`
(the one choke point all projection branches call), so triggers *and* `kg_reproject_all` honour it.
Entities 6,345 → 6,441; client limit raised to 8,000 in both call sites.

**Fixed en route:** `kpiHistory()` was unpaged, so the Analytics trend chart had been silently
plotting 1,000 of ~7,800 rows.

**Discoverability follow-up.** Only **8 of 200** projects carry activity/monthly grain, so a view
that can't render for the other 192 must offer a route into one — otherwise the honest empty state
is a dead end (John hit exactly this on Trends). `api.detailedProjectIds()` backs both fixes: the
Trends empty states show a *"Show me CRG-100 — …"* jump button (preferring a detailed project in
the same BU as the current focus), and the Gantt's `activity detail: 8 of 200` stat is now a toggle
that filters to those 8. **Rule for any new view: never state a data limitation without an
affordance past it.**

**New gotchas:** `new Date("YYYY-MM-DD")` is UTC and renders a day early west of Greenwich — use
`lib/time.js#parseDay`. d3-zoom calls `stopImmediatePropagation` on mousedown, so React's delegated
handlers never fire on a zoom-bound element (History brush needs `dragPans: false`). `innerText`
applies CSS `text-transform`, so don't assert on "Active filter". Synthetic `MouseEvent`s without
`view: window` throw inside d3 — use `page.mouse.*` in harnesses.

**Re-anchoring the demo clock:** `seed/generate.py` `TODAY` is a constant (now 2026-09-09) with a
`CLAYOS_SEED_TODAY` env override. Bump it and reseed when the data starts looking stale — the Time
views make that drift very visible.

---

## ⚡ Session 14 — self-explaining Analytics (read this first)
John: don't assume anyone is fluent in AEC KPIs. **Live** (`index-CzrADZa0.js`, 13/13 vs prod):
`lib/glossary.js` is now a structured **KPI_GUIDE** — every metric has plain-language
`{what, good, bad}`; `guideOf()` returns the entry, `defOf()` flattens it (so 3D-strip/BU-rollup
`title=` hovers upgraded for free). Dashboard: dotted metric labels are hover/tap **popovers**
(what + ✓ Good + ✗ Bad, viewport-clamped `ExplainerPop`); all 6 charts have an **"(i) explain"**
in-card panel (how to read the bars/lines + full guide per metric); map detail-card labels hover
too. Harness: `app/verify-analytics.mjs` (same CDP-attach pattern as verify-map).

---

## ⚡ Session 13 — 2D story → interactive US/world map (read this first)
John asked to replace the 2D story with a real interactive map. **Live** (`index-CE2ETz-t.js`,
13/13 headless vs prod): ontology modes are now **3D · Map · Network** — `MapView.jsx` (new)
replaces `LifecycleView.jsx` (deleted); old `ontoMode:"lifecycle"` links alias to `map`.
All 200 projects plot at their real seed `city/state` via a static lookup (`lib/geo.js`, 47 cities
+ state-centroid fallback — **no schema change, no reseed**). Basemap is d3-geo + TopoJSON
(world-atlas/us-atlas assets, no tile servers/keys). Same-city projects fan out in screen-space
clusters; dot click → shared focus (detail card w/ CPI/SPI/EAC/RFIs/TRIR; agent rescopes); agent
focus flies the map. Color-by BU / stage / **cost health**; size = contract $. `BU_PALETTE` now
lives in `lib/palette.js` (shared w/ 3D). Repo harness: `app/verify-map.mjs`.
**New box gotchas:** puppeteer can't launch snap chromium — spawn it with
`--remote-debugging-port` + `puppeteer.connect`; the profile dir must be a NON-hidden `$HOME`
path (AppArmor denies dot-dirs). And the first post-deploy prod load can still serve stale edge
cache — re-run before diagnosing.

---

## ⚡ Session 12 — agent normalization + pg_cron
`agent-ask` now normalizes `@@VIEW project=…@@` values server-side (name → code; evals 6/6, edge fn
redeployed). **Migration 014**: `kg_reproject_all()` chains the service-group projection (pass 3) —
proven by a full local reproject landing back at 6,345/8,561/17/722. **pg_cron is ON** with
`clayos_refresh_kpis` (*/30) + `clayos_snapshot_kpis` (04:20 UTC); the nightly `clayos_reproject`
job is deliberately NOT scheduled — it would wipe all embeddings nightly and the pg_net embed-drain
needs the service key stored in a DB setting (John's call). Remaining backlog: CI auto-deploy
(needs workflow-scoped token), RLS enable-path, TAG/CDC naming.

---

## ⚡ Session 11 — service groups as graph nodes (read this first)
**Agent status (2026-07-17): back up** — John topped up the Anthropic credits; evals **6/6**
(first re-run showed one nondeterministic focus-format miss — agent emitted the project *name*
instead of its code in the `@@VIEW@@` hint; the client's name-matcher covers that case, and the
second run passed clean).

Clayco's 17 service groups are now first-class `ServiceGroup` entities (migration
`013_service_groups.sql`): system-of-record `clayos.service_groups` + idempotent
`kg_project_service_groups()` projection → 17 nodes + 722 edges (new types **services**
group→project weight=record-count, **shares_data_with** group→group hand-offs; existing
**staffed_on** Person→group). Entities 6,345 / edges 8,561. `reseed-cloud.sh` re-runs the
projection after seeding — never insert into entities/edges directly, they're truncated on reseed.
UI: ⬢ ServiceGroup type + "Service groups" backbone lane (3D + 2D). Client subgraph limit
6000→6500 — kg_subgraph's alphabetical LIMIT had been silently cutting Space/Submittal/Work
since the 200-project reseed. TAG/CDC name expansions unconfirmed (rename in service_groups,
re-run the projection fn). Details in PROGRESS_LOG.

---

## ⚡ Session 10 — fps-watchdog hotfix
John hit "full mode reverts to lite after 2 seconds": the auto-downgrade re-armed on every quality
flip and its sample included shader-warmup jank. Now: explicit quality choice **always wins** and
persists (`clayos.quality.v1`, beats the mobile lite default), watchdog fires once per mount after a
1s warmup, and a transient notice explains any auto-downgrade. Verified 7/7 headless (software GL
triggers the watchdog for real); live as `index-BQCQwCCR.js`. Details in PROGRESS_LOG.

---

## ⚡ Session 9 — mobile-audit response (read this first)
Second external audit (400px/DPR2) — all actionable items fixed + shipped (bundle `index-BXg7hpwi.js`;
details in PROGRESS_LOG). The big one: **3D ran ~6 fps on phones**, so `Lifecycle3DView` now has a
**mobile perf budget** — lite default + DPR 1.25 + child dots sampled to ~1.8k (globe sizes stay
data-true) + 20 labels + flow panel collapsed to a chip. Also: touch targets ≥40–44px (sliders 3px→24px
hit area under coarse pointer), 2D-story rail → ☰ drawer (was squeezing the story to ~160px), network
labels appear-on-zoom on phones, mobile ask-bar clearance pb-24, table right-edge fade cue, and
**hashchange now re-routes** (pasted deep-links work after load). Mobile suite 16/16 at 390×844;
desktop regression 18/19 (known software-GL stall artifact). **Ask John to sanity-check 3D fps on a
real phone** — headless software GL can't measure it. The audit's "desktop 2D story still broken"
claim was stale — session 8 fixed it for both.

---

## ⚡ Session 8 — site-audit response (read this first)
John handed over an external audit (2 critical / 3 high / 3 medium / 3 low). **All actionable items
fixed + shipped live** (bundle `index-CIa0aMex.js`, prod verified; details in PROGRESS_LOG):

- **2D story fixed** (was a ~4% fit-scaled sliver at 200 projects): height-locked scale in a
  horizontal scroller + stage jump-chips. **Network freeze fixed**: FA2 moved to the
  graphology **web-worker supervisor** (+ Sigma waits for container width; `allowInvalidContainer`).
- Semantic headings (h1→h2→h3) · real `<label>`s + slider `aria-label`s · shared `lib/format.js`
  currency ($92.2B not $92171.5M) · chat dock minimizes to a ✦ pill + content clearance ·
  `chartColor()` makes Analytics honor the colorblind palette + `prefers-contrast` auto-contrast ·
  meta/OG/theme-color/**noindex** + new title · skip-link · **all views lazy** (entry 1.19MB→596KB).
- **Audit corrections worth remembering:** responsive breakpoints DO exist (8 width media queries in
  the compiled CSS — auditor missed the built stylesheet); network view is WebGL canvas, not SVG;
  the 2D-story bug was fit-scaling, not overflow clipping.
- **New box gotcha:** headless WebGL needs `--enable-unsafe-swiftshader` (NOT `--use-gl=swiftshader`,
  which disables GL → 3D crashes into the root ErrorBoundary → blank app). Poll up to ~30s for the
  2D/Network views — the 6k-row subgraph fetch on the micro instance can exceed 5s.

---

## ⚡ Session 7 — 200 projects + the orbital ontology (read this first)
The live demo now runs at **portfolio scale**: **200 projects / 6,328 entities** (8 deep + 192 light;
seed byte-preserves the deep projects and their goldens — new data comes from a separate RNG appended
at the end of `seed/generate.py`). The 3D view is now an **orbit around a glowing time axis**:
left→right = lifecycle, **radial distance = activity heat** (hot projects hug the core, dormant ones
drift out **and fade**), angle = business-unit sector, globe size = data volume, backbone below.
Analytics charts cap to top-14-by-signal (portfolio stats stay full-set). Evals updated for the new
landscape — **6/6 pass live**. `kg_subgraph` fetches at limit 6000 now; the graph is ~6.3k entities,
so watch the ~5k-node 3D comfort zone — cluster expand-on-zoom LOD is the known next step if it grows.

---

## ⚡ Session 6 — real-data direction: port the pattern into Snowflake (read this first)
John shared a data map of Clayco's real warehouse (`DB_CONTROL_TOWER`) and set the governing
constraint: **Supabase is not Clayco-approved — no real data lands here, ever.** So ClayOS is now
two tracks:
1. **This repo / the live app** — stays the synthetic demo + reference implementation. Unchanged.
2. **`integrations/snowflake/`** — the ClayOS pattern (ontology projection, KPI layer, guarded
   agent query) ported to Snowflake as a semantic layer over the real warehouse. Authored, NOT yet
   run: every warehouse column is `[INFERRED]`; `01_source_verification.sql` must run first and its
   answers get recorded in that folder's README. EVM computes **three EV bases side-by-side**
   (no true EV/PV exists in the warehouse). Plan of record:
   `/home/clawd/.claude/plans/db-control-tower-data-map-robust-comet.md`.
**Blocked on John (Phase 0):** Clayco IT approvals (schema owner, Cortex enabled?, approved app
hosting), service-user key pair, pilot slate (10–20 projects / 2 BUs) → insert into `PILOT_PROJECTS`.

---

## ⚡ Session 5 — phone drawers + clarity & display prefs (read this first)
Resumed an **interrupted, uncommitted session** (responsive edits applied; `HelpModal` / `Skeleton` /
`glossary.js` / `prefs.js` drafted but unwired). Finished the wiring and **shipped it live** at
https://clayos.pages.dev (bundle `index-2ylaE86h.js`, prod verified):

- **Phone drawers** (the session-4 deferred item): 3D + Network side rails → ☰ fixed drawers with
  backdrop; detail rails → bottom sheets; Sigma/3D canvases resize with their container
  (ResizeObserver) + 3D DPR clamped ≤2. Fixed a 24px overflow at 390px (header BU select).
- **Header "?"** → per-tab `HelpModal` (plain-language "what am I looking at?" for graph/data/dashboard).
- **Skeleton loading states** in Data + Analytics (`Skeleton.jsx`, `<ShimmerStyle/>` at app root).
- **KPI glossary hovers** (`glossary.js defOf`): CPI/SPI/EAC/TRIR/WIP/backlog… definitions on
  dotted-underlined labels in Analytics + the 3D KPI strip.
- **Header ⚙ display prefs** (persisted `clayos.display.v1`, `prefs.js`): **colorblind-safe palette**
  (`TYPE_COLOR_CB` Okabe-Ito; hue = family to match TYPE_SHAPE glyphs; `colorFor()` reads the active
  map and App remounts views on change), **higher contrast** (`.cl-contrast` CSS tier lift),
  **literal labels** (plain terms replace the vascular metaphor in the 3D view).
- Also: inline SVG favicon (prod 404'd it on every visit).

**Verified headless 17/17, 0 exceptions** at 1440px + 390px. Gotchas for next session: the
puppeteer-cache Chrome binaries **segfault on this box** — drive `/snap/bin/chromium` via
puppeteer-core with a home-dir `userDataDir` (snap can't write /tmp); `networkidle2` never fires on
this app — wait `domcontentloaded` + settle. Cloudflare edge caches `index.html` briefly — cache-bust
before concluding a deploy didn't take.

---

## ⚡ Session 4 — external-review response (read this first)
User pasted a thorough external review of the live app — **3 concrete issues + 10 improvements** —
and approved a 4-phase plan: **`/home/clawd/.claude/plans/sparkling-singing-lighthouse.md`**
("deploy when verified"). **Phase 1 = the 3 visible issues — SHIPPED LIVE** at https://clayos.pages.dev:

- **#2 Markdown** — agent answers render via `react-markdown`+`remark-gfm` in `AskDock` (was raw `##`/`**`).
- **#3 Streaming** — `agent-ask` streams **SSE** when the client sends `Accept: text/event-stream`:
  `tool` progress events ("pulling KPIs for Aurora") + `token` deltas + a `done` event with
  `{focus,highlight}`. **JSON path unchanged** (evals); `askStream` (api.js) falls back to JSON if a proxy
  collapses the stream. AskDock shows a typing indicator + live tool line.
- **#1 3D crash** — `TypeError … reading 'x'` root-caused (DragControls→`OrbitControls.onPointerUp` on a
  node drag-end's synthetic pointerup) and fixed with **`.enableNodeDrag(false)`** in `Lifecycle3DView`
  (nodes are pinned; drag was never wanted). Reproduced + verified 0 exceptions via CDP.
- **Also:** fixed a pre-existing `evals/run.mjs` bug (`const URL` shadowed the global), refreshed the
  safety golden (`9.27→9.43`, stale post-reseed). Evals now 5/6 → 6/6 with current data.

**Phase 2 (ontology UX & reliability) — ALSO LIVE** (bundle `index-Cdng8Lyc.js`): resizable/expandable
chat dock (#4), first-run **OntologyIntro** "what am I looking at?" overlay (#5), 3D **lite** quality
mode + auto-downgrade <25 fps (#9a), and **fixed the latent 1,000-row PostgREST cap** (B1) so the Data
table/3D see all 1,711 entities (`fetchAllRows`/`fetchAllRpc` in `api.js` — note the SETOF RPC ignores
the Range header, pages via ?limit/?offset). Verified headless: 0 exceptions, "of 1,711", chat resize.

**Phase 3 (cross-cutting clarity) — ALSO LIVE** (bundle `index-Bvy78TNs.js`): global active-filter bar +
Clear all + scope indicator + 🔗 copy-link (#6, App.jsx); Analytics zero-state clarity — support-group BU
cards + "no data" vs 0 tooltips (#8, DashboardView); per-chart CSV/PNG export + "✦ ask Clayco about this"
(seeds the chat) + explicit shareable deep-link honored-on-load-but-shown-in-the-bar (#10).

**Phase 4 (accessibility & responsive) — ALSO LIVE** (bundle `index-5U-XOR2J.js`): shape-by-family glyphs
in legends + Data type column so colour isn't the only cue (#7, `palette.js TYPE_SHAPE`); Data table ARIA
(scope/aria-sort/keyboard rows/focus); `aria-label`s on controls; 3D drift defaults off under
`prefers-reduced-motion`; responsive header wrap + `max-w-[80vw]` detail rails (no overflow at 834/390px).

**✅ ALL 4 REVIEW PHASES LIVE.** Edge fn deployed once (Phase 1); frontend deployed 4× (one per phase),
prod HTTP 200. Verified headless at each phase (0 runtime exceptions). **Deferred (see ROADMAP "Phase
2.7"):** full phone nav-drawer for the 3D/graph side rails, graph node-by-node keyboard cycling, and
network-graph LOD — none are blockers; the stated target was tablet. The bundle still ships as two ~1.4 MB
chunks (3D lazy-loaded) — code-splitting is a known optimization, not a regression.

---

## ⚡ Session 3 — what shipped (read this first)
Worked the approved 15-improvement plan (`/home/clawd/.claude/plans/melodic-herding-truffle.md`).
**Everything below is LIVE at https://clayos.pages.dev.**

- **Phase A:** fixed the Analytics charts (Recharts needed `min-w-0`); surfaced the previously-unused
  KPI matviews (WIP over/under-billing, backlog/pipeline/win-rate, workforce utilization); Analytics
  honors the focused project; Data table scopes to a vendor/employee highlight + CSV export; removed
  dead AskView. (NOTE: the URL-hash deep-link state was later trimmed to persist only tab/onto-mode —
  see the incident below.)
- **Phase B (data) — LIVE (cloud re-seeded 2026-06-29):** `seed/generate.py` adds **CRG — Clayco Real
  Estate Group** (development arm) as a BU with two CRG-branded synthetic projects (*The Cubes at
  Stateline* industrial, *Chapter at University Commons* student housing), **deepens all projects**
  (was 2 of 6), makes field activity realistic by stage, sector-aware spaces/elements, and **backfills
  12 months of kpi_history** for trend charts. Analytics has a new CPI/SPI **trend line**.
  **Cloud now: 6 BUs, 8 projects, 1,711 entities (was 750), 318 history rows, all 1,711 embeddings
  drained.** Re-seed is one command — **`./scripts/reseed-cloud.sh`** (self-cleaning TRUNCATE+insert,
  schema untouched, drains embeddings, ~2–3 min; deterministic, safe to re-run).
- **Phase C (verified live):** **`kg_query`** text-to-SQL agent tool (migration 011 — guarded read-only
  SELECT, owned by `clayos_readonly`, 5s/500-row caps; verified writes / multi-statement / `auth.*`
  reads all rejected) + **structured agent view-control** (agent emits `@@VIEW project=…/masterformat=…@@`,
  parsed server-side → `focus`/`highlight`; AskDock flies/highlights). Verified live: "status of Aurora"
  → focus DC-001; "avg RFI turnaround by discipline" → `kg_schema`+`kg_query`.
- **Quality / resilience:** app `ErrorBoundary`; Data table render-capped at 800 rows (sort/quant/CSV
  still operate on the full set); agent regression eval set (`evals/`); a **data-health banner** (see
  incident).
- **Scaffolding (local only, non-breaking):** migration 012 = field/exec RLS roles + JWT-claim helper
  (RLS **not** enabled — enable-path documented).

### ⚠️ Incident & lessons (important)
1. **Edge IP-block.** Heavy session load on the `micro` instance (hundreds of REST/DB calls + repeated
   headless loads + the user's own refreshes) tripped **Supabase's platform abuse protection**, which
   503'd the **user's browser IP at the edge** (preflight rejected upstream of the API gateway; invisible
   in gateway logs) while server-side curl (different IP) worked. Diagnosed via Management API:
   Network Restrictions = `0.0.0.0/0`/`::/0` (open), Network Bans = empty → not a config, it's the
   Cloudflare/abuse tier (auto-expires; not in the management API). **Verified by loading on a phone
   (different IP) → data showed.** Mitigation: **don't hammer the micro instance**; if a client IP gets
   503 at the edge, switch network/VPN or wait it out (or upgrade off `micro` / ask Supabase support).
2. **Silent zeros → banner.** The app used to render `$0 / Projects 0` when it couldn't reach Supabase,
   which read as "lost data / broken". Added `dataHealth()` + a red top banner ("Can't reach the data
   service … your network/IP may be blocked"). So connectivity issues now say so plainly.
3. **URL-hash footgun.** The original deep-link feature persisted `focus`/`hl`/`bu` to the hash, so a
   reload came back *scoped* and looked empty. Now only `tab`/`ontoMode` are persisted.

### Known follow-ups (small)
- **kg_entity_facts caps at 1,000 rows** via PostgREST's default max-rows. With 1,711 entities, ~the
  newest beyond 1,000 lack flow-pulse/$-vessel enrichment (globes + KPIs unaffected). Fix: paginate the
  RPC fetch in `app/src/lib/api.js#entityFacts` or raise the function's row cap.

### Deferred / blocked (with reasons)
- **CI auto-deploy (#4)** — the `gh` token still lacks `workflow` scope (workflow parked in `docs/deploy/`).
- **pg_cron (#4)** — schedules are in migration 009 (guarded); enable the extension on the cloud project
  then re-run 009's block to auto-refresh KPIs (KPIs are currently refreshed at seed/re-seed time only).
- **RLS enforcement (#9)** — scaffolding in migration 012; enabling policies is deliberate (changes what
  the anon key sees) — verify the read path first.
- **Semantic search in the UI (#11)** · **2D/Network ontology cross-filter** · **3D-view module split (#14b)**
  · **observability/Sentry (#15b)** — not done; noted in ROADMAP.
**Repo:** `/home/clawd/projects/clayos` → pushed to **github.com/jpm72780/clayos** (private, `main`)
**Live app:** **https://clayos.pages.dev** (HTTP 200)

---

## What this is

ClayOS is a **company operating system POC** for a large design-build firm (modeled on
**Clayco**). Five layers, roadmap order: (1) knowledge-graph ontology viewer, (2) reporting
by business unit, (3) KPI/metrics, (4) agentic natural-language Q&A, (5) app/workflow builder.
Full vision, rationale, and the approved plan: see **`docs/ARCHITECTURE.md`** and the canonical
plan file at `/home/clawd/.claude/plans/lets-create-a-new-breezy-curry.md`.

**Core architectural decision:** the knowledge graph is **Postgres-native** (no Neo4j).
Per-domain relational tables are the system of record; a generic `entities`/`edges` projection
(kept in sync by triggers) feeds the viewer + agent. See `docs/DECISIONS.md` ADR-001.

**Confirmed scope (user-approved):** synthetic seed data · thin slice through all 5 layers ·
new repo + new Supabase project · Postgres-native graph · depth-first (3 BUs, 5-6 projects).

---

## Current snapshot — where we are RIGHT NOW

**Phase:** Phase 1 complete & live. **Session 2 = ontology UX overhaul** toward a single
Palantir/OrgMap-style **linked-selection workspace** (user direction: "one interface for everything").

**Session-2 frontend state (all live at https://clayos.pages.dev → Ontology tab):**
- **Three ontology modes** (toggle in the Ontology tab header): **Lifecycle 3D** (default) · **2D story** · **Network** (the original Sigma graph).
- **Lifecycle 3D** = the centerpiece. Projects are **floating "vascular" globe-clusters** in 3D (x=lifecycle receding into depth, sized by data, tinted by business unit, faint membrane), connected by **thin vessels** with **flowing cyan particles = data points that "moved" in a time window**. Bloom + depth fog + drifting auto-orbit camera. Built on `3d-force-graph` + `three` + `three-spritetext` (added deps; lazy-loaded chunk).
- **Selection drives everything (the unification):** click a project globe → the docked **KPI strip** (bottom) rescopes to that project (CPI/SPI/EAC/RFIs/TRIR from the matviews) and the docked **Ask** box pre-loads its context. "↩ enterprise" resets.
- **Cross-cutting "Highlight by" rail:** MasterFormat (CSI) · UniFormat · Vendor · Employee — highlights that key across **every** project at once (highlight, don't remove). Backed by `classification_codes` + `entities.classification_id` (read via PostgREST, no schema change).
- **Flow controls panel:** time-window (1h→30d) · speed · size sliders; live "N moved" count.
- New frontend files: `app/src/views/Lifecycle3DView.jsx` (3D), `app/src/views/LifecycleView.jsx` (2D), plus `App.jsx`/`api.js` wiring.

*(Original Phase-1 snapshot below still holds — backend/agent/data unchanged this session.)*

**Phase 1 (vertical slice):** **COMPLETE & DEPLOYED LIVE.** All five layers demoable end-to-end.

**Live system (all working):**
- **App:** https://clayos.pages.dev (Cloudflare Pages) — Ontology viewer (Sigma), Reporting (Recharts), Ask ClayOS (chat).
- **Supabase:** project `fwaydsjpudusbaeyccjc` — schema + seed + 750 embeddings loaded; `clayos` schema exposed to PostgREST.
- **Edge functions:** `agent-ask` (Claude `opus-4-8` tool-loop) + `embed-entities`, deployed with secrets set.
- **Agent verified end-to-end on 2 question types** (against live cloud):
  - "Which Clayco Compute projects are over budget and why" → Aurora CPI 0.91 / SPI 0.839 / EAC $396.9M (cited).
  - "Which project has the worst safety record" → Aurora TRIR 9.27 vs Cedar Rapids 4.38 (correct comparison table).
  - Routes through kg_kpi/kg_search/kg_traverse/kg_get_entity; numbers come from KPI matviews (no hallucination).
- **Code:** github.com/jpm72780/clayos (`main`). Frontend data paths confirmed via anon PostgREST.

**Known caveats / not done:**
- **CI auto-deploy NOT enabled.** The Actions workflow is parked at `docs/deploy/github-actions-deploy.yml`
  (the available gh token lacks `workflow` scope; the fine-grained PAT has no access to this repo). To deploy
  now: `cd app && npm run build && npx wrangler pages deploy dist --project-name=clayos`. To enable CI: add
  the file to `.github/workflows/` with a `workflow`-scoped token and set repo secrets (CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_ACCOUNT_ID, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY — anon key is public-safe).
- **Frontend not yet visually verified in a browser** (build + all data paths via anon PostgREST confirmed; no screenshot taken).
- **pg_cron not enabled** on the cloud project (migration 009 no-op'd). KPI matviews are fresh from seed but
  won't auto-refresh until pg_cron is enabled + `refresh_all_kpis()` scheduled.
- RLS role-scoping and text-to-SQL (`kg_query`) deferred to Phase 2 (see ROADMAP).

---

### (historical) Phase 0 — Foundation — COMPLETE & verified on local Postgres.

**Done:**
- Repo scaffolded: `README.md`, `.gitignore`, `docker-compose.yml` (local pgvector PG on port
  **54329**), `scripts/db.sh` (up/down/reset/migrate/psql helper).
- **All 9 migrations written and applying clean** on local PG (`001`-`009`): extensions+helpers,
  classification, business_units, 35 domain tables, entities/edges graph + RPCs, projection
  triggers + embed queue + `kg_reproject_all()`, 8 KPI matviews + rollup + history, grants +
  `clayos_readonly` role, pg_cron (guarded → no-op locally).
- **Seed generator `seed/generate.py`** — deterministic, emits one SQL transaction (driver-free).
  Loaded: 3 BUs + service group, 6 projects (2 deep: DC-001 Aurora, DC-002 Cedar Rapids),
  **750 entities / 1004 edges / 750 embed jobs**.
- **Phase 0 exit criteria met & verified:**
  - EVM known-good: Aurora SPI **0.84** / CPI **0.91** (behind+over, EAC>BAC); Cedar Rapids
    SPI **1.04** / CPI **1.06** (healthy).
  - WIP: Aurora overbilled +$17.5M; Cedar Rapids underbilled −$11.3M.
  - Safety TRIR: Aurora 9.27 vs Cedar Rapids 4.38.
  - `kg_traverse` cross-domain works (Aurora reaches 255 entities @ 2 hops); `kg_subgraph`
    (Compute BU = 528 nodes/709 edges); `kg_bu_rollup` ltree rollup correct ($1.79B enterprise).
  - `kg_project_kpis` accepts both entity-id and domain-id.

**Local DB state:** container `clayos_db` is UP with all migrations + seed loaded. To rebuild from
scratch: `docker exec -i clayos_db psql -U clayos -d clayos -c "DROP SCHEMA clayos CASCADE"` then
re-run all migrations + `python3 seed/generate.py | docker exec -i clayos_db psql -U clayos -d clayos`.
(Note: `scripts/db.sh reset` can't delete `.pgdata` — it's owned by the container's postgres uid;
use the DROP SCHEMA path instead.)

*(The Phase-0 note above was written before cloud provisioning. Superseded by the Current snapshot:
cloud infra is now provisioned, seeded, embedded, and deployed.)*

---

## Flow enrichment — DONE (2026-06-28, session 2 cont.) ✓ live
1. ✓ **Flow means more** — pulse **colour by domain/type** (what moved), **speed by recency**, **hub pulse**
   (each project breathes brighter the more it moved in-window). 
2. ✓ **Real recency** — flow window driven by *actual* record dates via **migration 010 `kg_entity_facts()`**
   (`entities.updated_at` is all seed-time → recency comes from domain semantic dates). Verified vs DB:
   7d→5, 30d→49, all→459 data points moved. Migration applied to **local + cloud**; RPC anon-readable.
3. ✓ **Vessel thickness by $** — log-scaled width from `kg_entity_facts().amount` (contracts.value,
   cost_accounts.bac, pay_apps via lines, estimates/pursuits, projects.contract_value).

## Unification deepened — DONE (2026-06-28) ✓ live
- ✓ **Filters rescope the KPI strip**: an active Highlight-by selection turns the strip into a **slice
  rollup** — $ carried (from `kg_entity_facts().amount`), data points, projects touched, type breakdown.
  (Concrete = $421M across 6 projects, RFI 27 / Work 6 / CostAccount 6.)
- ✓ **Camera fly-to** a project's cluster when it gains focus (click or agent).
- ✓ **Agent drives the view**: if an answer/question names exactly one project, it focuses + flies there
  (verified: "status of Riverside?" → auto-focus Riverside). Pure client-side text match on project
  code/keyword — no edge-function change.

## Next actions
*(The structured focus hint + kg_query items that used to live here shipped in session 3 — Phase C.)*
- **CI auto-deploy** — needs a `workflow`-scoped gh token; workflow parked at `docs/deploy/`.
- **pg_cron** on the cloud project + reschedule `refresh_all_kpis()` (migration 009 patterns).
- **RLS enable-path** — scaffolding is migration 012; verify the anon read path before enabling.
- **kg_entity_facts pagination follow-up** — `fetchAllRpc` handles it client-side now; consider raising
  the function cap server-side instead.
- **Polish backlog** — semantic search in the UI (#11), graph node-by-node keyboard cycling,
  network-graph LOD (all deferred, none blocking). ~~Code-splitting~~ done in session 8 (all views
  lazy; entry chunk 596 KB). Map follow-ups if John wants them: state-level rollup choropleth,
  cluster spiderfy-on-click, honoring the cross-cutting Highlight-by slice on the map.

## Backlog (original Phase 2 — widen + deepen)

1. **Visually verify the UI** in a browser (or the /run skill): open https://clayos.pages.dev — confirm
   the Sigma graph renders + drill-down works, dashboards render, chat answers. Fix any runtime issues.
2. **Enable CI auto-deploy** (optional): move `docs/deploy/github-actions-deploy.yml` →
   `.github/workflows/deploy.yml` using a `workflow`-scoped token; set the 4 repo secrets.
3. **Enable pg_cron** on the cloud project + reschedule `refresh_all_kpis()` / `snapshot_kpis()` /
   `kg_reproject_all()` (migration 009 patterns; enable the extension first).
4. **`kg_query` text-to-SQL** tool with the safety harness (clayos_readonly role, single-SELECT
   validation, statement_timeout) — currently NOT in the tool registry.
5. **RLS scoping** by role (field user vs exec) + per-turn world-state tuning.
6. Deepen seed coverage (WIP/backlog/utilization dashboards, kpi_history trend charts).

## How to deploy right now (no CI)
- **Frontend:** `cd app && npm run build && npx wrangler pages deploy dist --project-name=clayos`
  (needs CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID from secrets.env).
- **DB migration:** `docker exec -i clayos_db psql "$CLAYOS_DB_SESSION_DSN" < migrations/NNN.sql`
  (source `/home/clawd/.config/clayos.env` first).
- **Edge function:** `supabase functions deploy <name> --project-ref fwaydsjpudusbaeyccjc --no-verify-jwt`.

---

## How to resume in a fresh session

1. Read this file, then `docs/ARCHITECTURE.md` (design) and `docs/ROADMAP.md` (phase checklist).
2. Skim `docs/PROGRESS_LOG.md` for what happened last and `docs/DECISIONS.md` for why.
3. `docs/INFRA.md` has all infra/credential pointers (Supabase, Cloudflare, n8n, secrets, VPS).
4. Reusable source patterns live in the sibling repo `/home/clawd/projects/counterpart`
   (OrgMapAI). Key files to copy/adapt are listed in `docs/ARCHITECTURE.md` §"Reuse map".
5. Pick up at "Next actions" above.

## Maintenance convention

At the end of each session, the working agent MUST:
- Update **this file's** "Current snapshot" + "Next actions" + the Last-updated line.
- Append a dated entry to **`docs/PROGRESS_LOG.md`**.
- Tick/maintain checkboxes in **`docs/ROADMAP.md`**.
- Add an ADR to **`docs/DECISIONS.md`** for any non-obvious decision made.
- Update **`docs/INFRA.md`** if any project/resource was provisioned (refs, URLs — never secrets).
