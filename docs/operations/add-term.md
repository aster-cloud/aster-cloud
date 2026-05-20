---
last-reviewed-at: 2026-05-20
owner: '@aster/glossary-stewards'
reviewer: '@aster/docs'
review-cadence: annual
---

# Runbook — Add a single term to the Glossary

**Plan**: `.claude/plan/glossary-contract.md` v7 §1.2 + §3.5

## When you need a glossary entry

```
Is the term user-facing (appears in UI text or public docs)?
├── No → don't add. Use ordinary code comments.
└── Yes → continue.
    │
    ├── Is it already in the glossary?
    │   ├── Yes → check `lifecycle.status`. If `superseded`, use the replacement.
    │   └── No → continue.
    │
    ├── Is it a homonym of an existing term (same surface string, different meaning)?
    │   ├── Yes → both terms need distinct `sense` + `disambiguation`. See split-term.md.
    │   └── No → continue.
    │
    └── Add the term to the appropriate `packages/glossary/src/terms/*.yaml`.
```

## Adding a term

1. Pick the right `terms/*.yaml` file by category (`telemetry`,
   `encryption`, `compliance`, `licensing`, `cron`, or add a new
   category file if none fits).
2. Use this template (see existing entries for shape):

   ```yaml
   <kebab-case-id>:
     id: <kebab-case-id>      # MUST match the YAML key
     category: <category>
     part-of-speech: noun | verb | adjective | adverb | phrase | acronym
     definition: >
       Plain-English one-sentence definition. Required.
     user-facing: true        # if false, the term is internal jargon
     introduced-in: <workstream-id, e.g. J5>
     lifecycle:
       status: active
       since-version: <next glossary release version>
       backbone-revision: 1
       reviewed-backbone-revision: { zh-CN: 1, de-DE: 1 }
     translations:
       en-US: <text>
       zh-CN: <text>
       de-DE: <text>
     match:
       mode: phrase           # literal | phrase | reviewed-regex
       case-sensitive: false
       boundary: unicode-word
       normalize: [case, width, punctuation, whitespace]
     forbidden-aliases:       # optional; document historic drift
       zh-CN: [{text: <bad-translation>, match: {mode: phrase}}]
   ```

3. If the term has multiple senses (homonym), set `sense` +
   `disambiguation` explicitly — the loader rejects collisions
   without them.

4. Run `pnpm test` in `aster-design-system/packages/glossary/` —
   contract tests will catch missing translations, alias cycles, etc.

5. PR review: glossary stewards check that the term is genuinely
   user-facing and not better represented as a code comment.

## After merge

- Next glossary release picks up the new term automatically.
- Consumer CIs flag the term if it appears in scanned surfaces.
- If you add an `en-US` translation that's already in active use in
  `aster-cloud/messages/en.json` or `aster-lang-dev/docs/**.md`, the
  scanner will start enforcing it from the next release.

## Related runbooks

- `split-term.md` — splitting a homonym after the fact.
- `deprecate-term.md` — retiring a term.
- `backbone-revision.md` — editing en-US in place.
