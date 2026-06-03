# Docs Enterprise UX — Implementation Plan

**Goal**: Transform `aster-lang.cloud/docs/*` from anonymous static reference into a session-aware, action-oriented documentation experience for logged-in enterprise users — without leaking PII, breaking SSR cache hygiene, or degrading anonymous LCP.

**Scope**: 10 modules, ~56 engineer-days, structured as 6 phases. Each phase ends with a green build + multi-model audit ≥95 + commit + push, so phases can ship independently behind feature flags.

**Decisions accepted (defaults)**:
- Rollout: phased GA (modules 1-4 first, then 5-6)
- Search index size cap: 25KB/locale gzip
- Personalized home: pure localStorage (no backend)
- Audit log: cross-domain jumps only (no impression/search logging)
- Task IA: 6 tasks at launch

**Hard constraints (non-negotiable, from architecture analysis)**:
1. Docs RSC never reads `auth()` / session — client `<SessionProbe>` only.
2. `/api/docs/session-state` returns booleans only, `Cache-Control: private, no-store`.
3. Personalization URL never carries tenant — only `?from=docs&template=…&locale=…`.
4. en/zh/de strict parity, enforced by existing messages consistency test.
5. PII scan CI gate (grep dist for email regex + `session.user.*` strings).

---

## Phase 1 — Session-aware chrome foundation (~9 days)

**Modules**: 1 (session layer) + 2 (chrome) + i18n keys.

### 1.1 Session probe endpoint
- New `src/app/api/docs/session-state/route.ts`
- Returns `{ authenticated: boolean, capabilities: { canUsePlayground, canEditPolicies, canViewAudit, hasActiveTeam }, schemaVersion: 1 }`
- Headers: `Cache-Control: private, no-store, max-age=0` + `Vary: Cookie`
- Rate limit: 60 req/min/IP (use existing rate-limit infra)
- On error: 503 + `{ authenticated: false }` (fail-closed)
- Metric: `docs_session_probe_latency_ms`, `docs_session_probe_errors_total`

### 1.2 Client session probe
- New `src/lib/docs/use-docs-session.ts` — React Context + `useDocsSession()` hook
- localStorage cache `{ state: 'authenticated'|'anonymous', ts }` with 5-min TTL
- SWR pattern: render cached state immediately, revalidate in background
- One retry on failure, then fall back to anonymous
- Exposed states: `probing` | `authenticated` | `anonymous`

### 1.3 DocsTopNav state machine
- Three render branches: `probing` (skeleton) → `authenticated` (avatar + Dashboard) | `anonymous` (Sign in + Open Console)
- Avatar uses deterministic gradient from non-PII `subjectHash` (returned by probe, not the raw userId)
- Radix `DropdownMenu` for the avatar menu (already in `@aster-cloud/ui`)
- `aria-live="polite"` on the swap container so SR users hear state changes
- No layout shift (skeleton matches final dimensions)

### 1.4 i18n keys (en/zh/de)
```
docs.nav.dashboard
docs.nav.signIn
docs.nav.openConsole       (already exists, reuse)
docs.nav.userMenu.dashboard
docs.nav.userMenu.settings
docs.nav.userMenu.signOut
docs.nav.userMenu.label
docs.session.probing       (a11y aria-label only)
```

### 1.5 PII CI gate
- New `scripts/docs-pii-scan.mjs` — runs after build, greps `.open-next/server-functions/**/*` for:
  - email regex `[\w.-]+@[\w.-]+\.\w+`
  - literal `session.user.email`, `session.user.name`, `team.name`, `tenant.name`
  - if any match outside test fixtures → exit 1
- Wire into `package.json` `build:next` postscript
- Document allow-list pattern in script for legitimate cases

### 1.6 Tests
- Unit: probe state machine (`probing`/`authenticated`/`anonymous`/`error`)
- Integration: `/api/docs/session-state` 200/401/503 + cache headers
- E2E (Playwright): docs renders in all 3 locales × 2 auth states (matrix-driven, 6 cases)
  - Each case asserts: HTML has no email/team-name fixtures, nav shows correct state, console doesn't 404 on prefetch

### 1.7 Telemetry
- Mixpanel: `docs_session_probe { authenticated, status, latency_ms, error_code }`
- Don't log on every page view (debounce to 1/min/user)

---

## Phase 2 — Page-level action bar (~6 days)

**Module**: 2 (DocsPageActions) + URL→action registry.

### 2.1 Registry schema
- New `src/lib/docs/page-actions.ts`
- TypeScript-enforced: every slug in `docsSidebar` MUST have a `PageActionSet`
- Compile-time exhaustiveness via discriminated unions

### 2.2 Per-route action sets (21 API pages + 4 getting-started)
- Each page gets `primaryAction` + `secondaryActions[]`
- Examples:
  - `api/policies/evaluate`: primary = "Try in Playground" (anon-safe, preview tenant); secondary = "Open in Editor" (auth-only, `?from=docs&template=evaluate-source`)
  - `api/audit/logs`: primary = "View my audit logs" (auth-gated); secondary = "Try in Playground"
  - Quickstart pages: primary = "Continue to next step" (deep-linked dashboard CTAs)

### 2.3 `<DocsPageActions>` component
- Mounts between `DocsBreadcrumb` and `<h1>` in docs layout
- Subscribes to `useDocsSession()` for capability filtering
- Anonymous: shows only `primaryAction` if it's anon-safe; otherwise hidden
- Authenticated: shows all actions filtered by capabilities
- Sticky on scroll (CSS `position: sticky; top: 4rem` — clears DocsTopNav)
- Mobile: collapses to a single overflow menu (avoid taking first-fold real estate)
- a11y: each action has `aria-label` with full intent; keyboard focus order matches visual

### 2.4 Audit log on cross-domain jump
- Action clicks that target `/dashboard/**`, `/policies/**`, `/playground` etc. write to `audit_logs` via existing infrastructure
- Schema: `actor=userId, action='open_from_docs', metadata={ source_slug, cta_id, locale }`
- Anonymous clicks skipped (no actor)

### 2.5 i18n keys
- `docs.actions.tryInPlayground`
- `docs.actions.openInEditor`
- `docs.actions.viewMyAuditLogs`
- `docs.actions.viewMyTraces`
- `docs.actions.continueQuickstart`
- ... ~12 total

### 2.6 Tests
- Unit: registry completeness (compile-time + runtime assertion all routes have entry)
- Unit: capability gating logic
- E2E: each action targets the correct URL with correct query params (6 cases)
- E2E: anonymous user doesn't see auth-only actions
- E2E: audit log row written on click (mocked endpoint)

### 2.7 Telemetry
- `docs_cta_impression { route_slug, cta_id, position, auth_state }` (sample 10%)
- `docs_cta_clicked { route_slug, cta_id, target, auth_state, locale }` (100%)

---

## Phase 3 — Code-block actions (~7 days)

**Module**: 3 (EnhancedCodeGroup + rehype-snippet-meta).

### 3.1 `rehype-snippet-meta` plugin
- New `src/lib/mdx/rehype-snippet-meta.ts`
- Parses code fence info string: `` ```bash {playground=true,id=evaluate-curl,language=bash} ``
- Emits `data-playground`, `data-snippet-id`, `data-snippet-lang` on the `<pre>` element
- Build-time only — zero runtime cost; data lives in static HTML attributes
- Add to MDX pipeline in `next.config.ts` after `rehype-pretty-code`

### 3.2 Code fence metadata for 63 MDX files
- Migration script `scripts/migrate-mdx-snippet-meta.mjs`:
  - Reads each code fence
  - Auto-assigns stable `snippet-id` based on `route-slug + fence-index`
  - Sets `playground=true` for fences that have a corresponding playground template
- Idempotent (re-runs match existing IDs)
- Updates all 63 files (en/zh/de × 21 pages)

### 3.3 `<EnhancedCodeGroup>` component
- Replaces `<CodeGroup>` in `mdx-callouts.tsx`
- Toolbar (top-right): `Copy` | optional `Open in Playground` (only when `data-playground`)
- `Copy`: `navigator.clipboard.writeText(textContent)` + visual confirmation + `aria-live` announcement
- `Open in Playground`: builds URL `/playground?template=${snippetId}&from=docs&locale=${locale}`
- Long snippet collapse: > 30 lines → fold with "Expand" button
- a11y: every button has `aria-label`, focus ring visible, keyboard-actionable

### 3.4 Playground template whitelist
- New `src/lib/playground/snippet-templates.ts` — registry mapping `snippet-id` → safe template
- Playground server-side route loads template by ID, rejects unknown IDs (prevents URL-carried source injection)
- All 21 API pages' fences mapped to corresponding templates

### 3.5 i18n keys
- `docs.codeBlock.copy`
- `docs.codeBlock.copied`
- `docs.codeBlock.openInPlayground`
- `docs.codeBlock.expand`
- `docs.codeBlock.collapse`
- `docs.codeBlock.copyAriaLabel`

### 3.6 Tests
- Unit: rehype plugin emits correct data attributes for various meta strings
- Unit: snippet ID stability (same input → same ID across runs)
- Unit: playground template whitelist lookup
- E2E: copy button writes correct content to clipboard (use Playwright clipboard API)
- E2E: Open in Playground lands on correct URL with correct template loaded
- E2E: unknown snippet ID returns 404 from playground

### 3.7 Telemetry
- `docs_snippet_copied { route_slug, snippet_id, language }`
- `docs_snippet_opened { route_slug, snippet_id, target=playground }`

---

## Phase 4 — Quickstart + Trust footer (~5 days)

**Module**: 4.

### 4.1 `<ActionableStep>` component
- Used in all locales of `getting-started/quickstart/*.mdx`
- Props: `step: number, titleKey, descriptionKey, action: { href, labelKey, capability? }`
- Logged in: action button directly navigates
- Anonymous: action button replaced with "Sign in to continue" → returns to step after login
- Visual: numbered badge + content + CTA, consistent with rest of docs

### 4.2 Quickstart MDX edits (en/zh/de × 1 quickstart page = 3 files)
- Replace text descriptions with `<ActionableStep>` for steps 1–4
- Step 1: Get tenant ID → `/settings/api-keys`
- Step 2: Create API key → `/settings/api-keys?new=true`
- Step 3: Run in Playground → `/playground`
- Step 4: View first trace → `/policies` (then evaluate to land on traces)

### 4.3 MDX frontmatter migration
- Script `scripts/migrate-mdx-frontmatter.mjs`:
  - Adds `updated` field set to file's git last-modified date
  - Adds `apiVersion: v1` default
  - Adds `changelog` field (optional, points to `/changelog/<route>`)
- Idempotent — only adds missing fields
- Runs across all 63 MDX files
- CI validation: all docs pages must have `updated` and `apiVersion`

### 4.4 `<DocsTrustFooter>` component
- Renders at the bottom of every docs page (mounted in `DocsLayout` after `{children}`)
- Reads frontmatter from MDX module (already exported as `frontmatter` per `generate-page-wrappers.mjs`)
- Public row: `Last updated <date> · API version <v1> · Compatible with engine ≥ <v> · View changelog · Suggest edit`
- Authenticated extension row (if `capabilities.hasActiveTeam`): `Your tenant API version: <from probe> · SLA: <from probe>`
- "Suggest edit" → GitHub issue with prefilled template (route slug + locale)
- a11y: footer landmark `<footer aria-label="...">`, links keyboard-actionable

### 4.5 i18n keys
- `docs.trustFooter.lastUpdated`
- `docs.trustFooter.apiVersion`
- `docs.trustFooter.compatibility`
- `docs.trustFooter.changelog`
- `docs.trustFooter.suggestEdit`
- `docs.trustFooter.yourTenantVersion`
- `docs.quickstart.step{1,2,3,4}.{title,description,cta}`

### 4.6 Tests
- Unit: frontmatter parser tolerates missing optional fields
- Unit: ActionableStep capability gating
- E2E: trust footer renders on all 21 API pages
- E2E: suggest-edit link opens correct GitHub URL with prefilled template
- E2E: quickstart steps land on correct URLs (auth + anon)

### 4.7 Phase 1-4 GA gate
- This is the first user-visible GA milestone.
- All Phase 1-4 modules behind a single flag `docs.experienceV2`.
- 5% → 25% → 50% → 100% rollout.

---

## Phase 5 — Unified search via CommandPalette (~8 days)

**Module**: 5.

### 5.1 Lift CommandPalette to root layout
- Move from `(dashboard)/layout.tsx` to `[locale]/layout.tsx`
- Source registry pattern: each section contributes commands
- `dashboardCommands` (existing) — gated by auth + route group
- `docsCommands` (new) — always available

### 5.2 Build-time docs index
- New `scripts/build-docs-index.mjs`:
  - For each MDX: extract `title`, `description`, frontmatter keywords, all H2/H3 headings
  - Build per-locale JSON `src/lib/docs/search-index.{en,zh,de}.json`
  - Hard cap 25KB gzip per locale; build fails if exceeded (forces trimming)
  - Index runs as build step before `next build`

### 5.3 Synonyms (per-locale)
- `src/lib/docs/synonyms.{en,zh,de}.json`
- Maps short aliases to canonical terms (e.g., `auth → authentication`, `认证 → 鉴权`, `Anmeldung → Authentifizierung`)
- Used to expand user queries at search time

### 5.4 Search algorithm (zero-dep, no Fuse)
- Substring match on title + headings + description
- Prefix match on words for autocomplete feel
- Rank: exact title > heading > description > body (not in index)
- Current route bumped slightly
- Limit 8 results, sorted

### 5.5 Lazy load
- Index dynamically imported only when palette opens (saves bundle on first load)
- LocaleSpecific import via dynamic `import(\`./search-index.${locale}.json\`)`

### 5.6 Sidebar search affordance
- New search input at top of `DocsSidebar` opens the palette pre-filled
- Mobile: floating button bottom-right
- Cmd/Ctrl + K still global

### 5.7 i18n keys
- `docs.search.placeholder`
- `docs.search.noResults`
- `docs.search.resultsCount`
- `docs.search.openShortcut`
- `palette.docs.sectionLabel`

### 5.8 Tests
- Unit: search algorithm (relevance ordering, synonym expansion, locale routing)
- Unit: index size budget enforcement
- E2E: Cmd+K opens palette from docs and dashboard
- E2E: query "authentication" returns the authentication page across locales
- E2E: result selection navigates correctly

### 5.9 Telemetry
- `docs_search_opened { source, auth_state }`
- `docs_search_result_clicked { result_rank, result_slug, locale }`
- NOT logging queries (privacy)

---

## Phase 6 — IA dual-mode + personalized home (~7 days)

**Module**: 6.

### 6.1 Sidebar segmented control
- `DocsSidebar` gets a top tab: `Reference` (default) | `By task`
- State persisted in localStorage `docs.sidebar.mode`
- URL doesn't change (task view is a different entry path to the same MDX pages)

### 6.2 Task-view configuration
- New `src/lib/docs/task-views.ts`:
  - `taskViews: TaskView[]` — each with `id`, `titleKey`, `descriptionKey`, `pages: RouteSlug[]`
- Six tasks at launch:
  1. Build my first policy
  2. Evaluate a policy in 3 ways
  3. Debug with Decision Trace
  4. Audit a compliance decision
  5. Migrate from v1
  6. Set up production API auth
- Each task page references existing MDX (no content rewrite needed)

### 6.3 Breadcrumb override in task mode
- When user enters via task view, breadcrumb shows `Tasks › <Task name> › Step N` instead of reference path
- Implementation: query param `?task=<id>` preserved across task navigation
- DocsBreadcrumb reads `useSearchParams()` and overrides

### 6.4 Personalized docs home (`/docs` for logged-in users)
- Anonymous: existing redirect to `/docs/getting-started/overview` (no change)
- Authenticated: render `<DocsHomeAuthenticated>` client component
  - `Resume reading` — last visited docs page (localStorage)
  - `Recent docs` — last 5 visited (localStorage, deduped, with timestamps)
  - `Suggested next step` — capability-driven (no API key yet → settings; has key but no policy → policies/new)
  - `Quick links` — Playground / New policy / API keys / Recent traces
- Redirect logic moves into the page component (probe → render or redirect)

### 6.5 Visit tracking (client-side only)
- New `src/lib/docs/use-visit-tracking.ts`
- On docs page mount, record `{ slug, title, ts }` to localStorage `docs.visits[]`
- Bounded to last 20 entries
- Privacy: localStorage only, no server roundtrip, no PII

### 6.6 i18n keys
- `docs.sidebar.mode.reference`
- `docs.sidebar.mode.tasks`
- `docs.tasks.*.title/description` (6 tasks × 2 fields)
- `docs.home.authenticated.title`
- `docs.home.authenticated.resumeReading`
- `docs.home.authenticated.recentDocs`
- `docs.home.authenticated.suggestedNext`
- `docs.home.authenticated.quickLinks`

### 6.7 Tests
- Unit: task-view config completeness
- Unit: visit tracking dedup + cap
- Unit: suggested-next logic per capability shape
- E2E: switch sidebar mode, verify persistence
- E2E: enter via task view, verify breadcrumb override
- E2E: authenticated `/docs` renders home component; anonymous redirects
- E2E: PII not leaked into personalized home HTML

### 6.8 Telemetry
- `docs_home_personalized { recents_count, has_resume }` (on home render)
- `docs_task_view_switched { from, to }`

---

## Cross-cutting concerns

### Observability (Phase 7 implied, done per-phase)
- Mixpanel events listed per phase
- Grafana dashboard `docs-experience`:
  - Panels: CTA CTR, search query funnel, probe p95 latency, PII scan results
  - Created once after Phase 1, extended per phase
- Alerts (PagerDuty):
  - Probe success < 99.5% × 10min
  - LCP p75 > 2.5s × 5min
  - PII scan CI failures (block deploy)
  - Bundle size budget exceeded

### Performance budget
- docs LCP p75 ≤ 2.0s — Lighthouse CI enforces in PR
- docs TTFB p95 ≤ 250ms
- docs route bundle delta ≤ 30KB gzip
- search index ≤ 25KB gzip per locale

### a11y (continuous)
- All new interactive components: keyboard, screen reader, focus ring, prefers-reduced-motion
- axe-core in Playwright on every new docs page
- Manual NVDA + VoiceOver pass before each phase GA

### i18n (continuous)
- en/zh/de strict parity, CI-enforced
- Glossary preserved: Playground / Decision Trace / API Explorer / tenant stay English in zh/de prose
- German labels reserved +35% width
- New keys go in all three files in same commit

### Feature flags
- Per module + per phase
- Existing `FeatureFlagsCard` infra; add the new flag IDs
- Kill-switch reachable in `/admin` overview

### Rollout cadence
- Phase 1 → 2 → 3 → 4 → GA (modules 1-4 batch)
- Phase 5 → GA
- Phase 6 → GA
- Each phase: 5% → 25% → 50% → 100% with 24h soak between rungs

### Audit + commit policy
- Every phase ends with codex backend + codex frontend audit, both ≥ 95
- Iterate fixes in-loop until passing
- Commit + push per phase (smaller blast radius than one big commit)

### Definition of Done (per phase)
1. ✅ Build clean
2. ✅ All new unit/integration/E2E tests passing
3. ✅ Lighthouse CI green (LCP p75 ≤ 2.0s)
4. ✅ axe-core a11y check green
5. ✅ PII scan green
6. ✅ Mixpanel events firing correctly (verified in staging)
7. ✅ Backend audit ≥ 95
8. ✅ Frontend audit ≥ 95
9. ✅ All i18n keys in en/zh/de
10. ✅ Commit pushed to origin/main

---

## Risks log

| Risk | Mitigation |
|---|---|
| Session probe adds front-end complexity | Strict separation: probe state is a hook, components opt in; default to anonymous |
| Code fence migration touches 63 files | Idempotent script, dry-run mode, generated IDs are stable across runs |
| Search index grows with new docs | CI budget check; if exceeded, force-trim non-essential fields |
| Personalized home reveals usage patterns | localStorage only; clears with browser data; no server retention |
| Task IA confuses reference users | Default mode = Reference; toggle persisted; URLs unchanged |
| German labels overflow | Phase 1 includes mobile layout test for longest DE strings |
| Audit log volume from CTA clicks | Only cross-domain jumps logged (not impressions); estimate < 1k rows/day |

---

## Implementation order (start now)

Implementing in phase order, never skipping ahead. Each phase = one commit + one audit pass.

Begin: **Phase 1, task 1.1** — session probe endpoint.
