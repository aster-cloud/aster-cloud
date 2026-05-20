---
last-reviewed-at: 2026-05-20
owner: '@aster/glossary-stewards'
reviewer: '@aster/lang'
review-cadence: annual
---

# Runbook — Split a term into multiple concepts

**Plan**: `.claude/plan/glossary-contract.md` v7 §1.2 + §11
**When**: A previously-singular term turns out to mean two distinct
concepts (homonymy discovered after the fact).

Example: "key" used for both "license key" (credential) and "KEK"
(cryptographic). The schema requires distinct concept IDs with
explicit `sense` + `disambiguation`.

## Procedure

1. **Identify the two (or more) distinct concepts.** Write a one-line
   `sense:` for each.
2. **Open Day-0 PR** in `aster-design-system`:
   - Introduce new concept IDs (e.g., `license-key`, `kek`).
   - Each gets `lifecycle.replaces: <original-id>`.
   - Translations + match rules for each.
3. **Mark original term `superseded-by: <list>`**:
   ```yaml
   key:
     lifecycle:
       status: deprecated
       superseded-by: license-key,kek    # comma-list of replacements
   ```
4. **Stage 3 migration PRs** in every consumer to disambiguate usage.
5. After 90-day deprecation window (per `deprecate-term.md`),
   `key`'s `lifecycle.status` flips to `superseded`. Scanner now
   hard-flags any remaining usage with hint pointing to the
   replacements.

## Edge cases

- **More than 2 splits**: same procedure. Each replacement gets its
  own concept ID with distinct `sense`.
- **One replacement is "we never meant this"**: mark it
  `lifecycle.status: superseded` with `superseded-by: <correct-id>`,
  no Stage 3 work needed.
- **Cross-locale split**: if zh used one term for both concepts but
  en used two, the original entry should never have had a `zh-CN`
  translation that conflated them. Treat as historic bug; backfill
  zh translation per concept.

## Related runbooks

- `deprecate-term.md` — the 90-day window mechanics.
- `add-term.md` — creating the new concept IDs.
- `backbone-revision.md` — for changing en-US text without splitting.
