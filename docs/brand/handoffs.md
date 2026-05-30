# Handoffs from the cross-site UX cleanup

Two follow-ups that need humans outside this repo. Logged here so they
don't get lost when the implementation PRs merge.

## #1 — Email routing verification (ops)

**Owner**: ops / infra

**Why**: PR-4 + the dev pricing reroute changed two mailto targets to
`sales@aster-lang.cloud`. The address must (a) accept inbound mail and
(b) forward any in-flight inbound from the deprecated address.

**Action items**:

1. **Confirm `sales@aster-lang.cloud` is provisioned** and forwards to a
   real human inbox (or shared mailbox). Test by sending an email and
   verifying delivery.

2. **Add a forwarder for `enterprise@aster-lang.dev`** → `sales@aster-lang.cloud`,
   at least through 2026-Q4, to catch any prospect emailing the old
   address from cached pages, bookmarks, or search-engine results.

3. **Confirm `hello@aster-lang.dev`** still routes to the OSS / community
   triage queue. After this cleanup, `hello@` is reserved for
   community / partnership inquiries; commercial sales goes elsewhere.

**Acceptance**: send a test email to `sales@aster-lang.cloud`,
`enterprise@aster-lang.dev`, and `hello@aster-lang.dev`; the first two
should land in the same sales inbox, the third should land in
community.

## #2 — Wordmark SVG (design)

**Owner**: design

**Why**: aster-lang-dev currently uses `/logo.svg` as a square mark next
to a text `Aster Lang` label rendered by VitePress. The Cloud dashboard
uses `<Wordmark>` from `@aster-cloud/ui` which is a typeset lockup.
Dev should match.

**Deliverable**:
- `docs/public/wordmark-aster-lang.svg` in the dev repo
- Pure wordmark only (no tagline) — the tagline belongs in hero/meta
- Legible at nav height (~28px) on both light and dark mode
- Same letterforms / weight as the Cloud Wordmark for cross-site
  consistency

**Wire-up** (one-line code change after the asset lands):
```ts
// docs/.vitepress/config.shared.ts (or per-locale)
themeConfig: {
  logo: '/wordmark-aster-lang.svg',  // replaces '/logo.svg'
}
```

Keep `/logo.svg` as the favicon source.

**Acceptance**: dev portal nav shows the wordmark lockup matching
Cloud at all viewports;  contrast checker passes for both modes.
