# 0014 — Route ownership contract between aster-cloud and aster-lang-dev

Status: Accepted (Phase 1 — schema + bootstrap manifests)
Date: 2026-06-04
Companions: `aster-lang-dev/docs/adr/0010-route-ownership-contract.md`

## Context

Aster runs two public sites under one brand:

- **aster-lang.cloud** (this repo) — commercial SaaS: auth, dashboard, billing,
  application docs at `/docs/*`, REST/GraphQL/WS API.
- **aster-lang.dev** (`aster-lang-dev` repo) — open-source language site:
  marketing, browser playground, language pedagogy at `/learn/*`, community/
  contributor hub at `/community/*`, blog.

Cross-site links happen in many places: docs MDX references, CTA buttons,
i18n messages, marketing copy, the `_redirects` file. Until now there was no
single declared source of truth for who owns which URL. The result has been
predictable:

- `/playground` was advertised by Cloud docs but never existed as a real
  route (only `/api/playground/*` existed). Every `?from=docs&template=…`
  link 404'd.
- `/zh/zh/policies` regression: a next-intl `Link` component automatically
  prefixed a locale that the caller had already prefixed by hand.
- Legacy paths like `/api/v1/policies/evaluate-source` (when typed into a
  browser at the wrong domain) silently land on a 404 instead of redirecting
  to the canonical doc.

These are not three different bugs. They are the same bug — no contract
declaring "this URL is owned by site X" — surfacing in different shapes.

## Decision

Introduce a per-repo route ownership manifest at
**`config/routes.yaml`** (in this repo) and
**`aster-lang-dev/config/routes.yaml`** (in the sibling repo).

Every public URL on either site must appear in exactly one manifest entry
on its owning side, classified as:

| status | meaning |
|---|---|
| `canonical-here` | This site owns the route and serves a page/route handler at it. |
| `mirror` | This site renders a copy of content whose canonical URL is on the other site. Used sparingly for legal/compliance pages. |
| `redirect-to` | This site only redirects to a canonical URL elsewhere. The canonical URL goes in `canonicalUrl`. |

The schema lives in `config/routes.yaml` itself (top-of-file comments) and
will be formalised as a JSON Schema in Phase 2.

### What this Phase 1 delivers

1. The two YAML manifests, hand-curated to cover the highest-traffic and
   highest-risk routes (everything that has 404'd in the last quarter,
   everything in the dashboard chrome, every entry in `docs/sidebar.ts`,
   every active `_redirects` rule).
2. This ADR + its sibling.
3. No generator, no link-checker, no CI enforcement yet. That is Phase 2/3.

### What Phase 2 will deliver

- Auto-generated `public/.well-known/routes.json` from the YAML (committed,
  reviewed, deterministic — no live HTTP fetch in CI).
- `scripts/routes/check-route-coverage.ts` that walks `src/app/[locale]/**/page.tsx`
  + `src/app/api/**/route.ts` + `src/lib/docs/sidebar.ts` and fails if any
  public route is missing from the manifest.

### What Phase 3 will deliver

- `scripts/routes/check-links.ts` that walks MDX + JSX + i18n messages,
  extracts cross-site links, and validates them against the OTHER repo's
  committed manifest snapshot.
- Wired into `.github/workflows/ci.yml` with hard fail semantics for
  dangling refs and references to `redirect-to` URLs (callers must use
  the canonical URL directly).

## Evolution rules

- **Adding a route** — same PR that adds the page/route handler must add a
  manifest entry. Phase 2 will enforce.
- **Moving a route** — old path stays in the manifest as `redirect-to`
  pointing at the new canonical URL. Drop the entry only after one full
  deprecation cycle (~1 quarter).
- **Adding a locale** — update `locales.prefixed`. The Phase 2 generator
  handles the prefix expansion.
- **Cross-site move** — coordinate the two PRs. The losing side flips its
  entry to `redirect-to`; the winning side adds a `canonical-here`. The
  Cloudflare `_redirects` file gets the matching 308.
- **Adding a `mirror`** — requires a `notes:` line explaining why both sides
  render the content (typically legal/compliance pages that need to be
  publicly discoverable on both domains).

## Consequences

Positive:
- The next `/playground`-style outage gets caught at PR time, not after
  deploy.
- Onboarding gets simpler: a contributor wondering "where does this URL
  live?" can grep two files.
- Both sites' Cloudflare config + Next config + VitePress config become
  cross-checkable against a single declarative truth.

Negative:
- Two manifests can drift if a cross-site move ships in one repo before the
  other. Mitigation: Phase 3 cross-repo snapshot fetch with CI freshness
  check.
- Hand-curated Phase 1 manifests will have gaps. Phase 2's coverage
  verifier will surface them; until then, callers should treat the
  manifests as advisory.
- Schema evolution requires both repos to update in lock-step. Mitigation:
  version field in the YAML top, generator will refuse mismatched versions.

## Rejected alternatives

- **Live fetch of `/.well-known/routes.json` in CI.** Catches production
  drift, but couples PR latency to deploy freshness and adds a network
  flake surface.
- **Single shared manifest in one of the repos.** Forces release coupling;
  each site's deploys are independent today and that should not change.
- **Infer ownership from routes only (no manifest).** Misses `mirror` and
  `redirect-to` semantics; the bugs we want to prevent (e.g. authoring a
  link to a `redirect-to` URL) cannot be detected without explicit status.
- **Redirect-only contract (just keep `_redirects` accurate).** Catches
  the redirect class of bugs but not the `redirect-to`-as-link-target class
  (the `/playground` bug). Needs `canonical-here` + `redirect-to` together.
