# CTA and naming conventions

Single source of truth for the way we name the product and write
call-to-action labels across `aster-cloud` (the SaaS dashboard) and
`aster-lang-dev` (the developer / language portal).

## Naming

| Term | Meaning |
|---|---|
| **Aster Lang** | The open-source policy language + engine. Lives at `aster-lang.dev`. Includes the parser, GraalVM Truffle interpreter, browser TS engine, and language packs. |
| **Aster Cloud** | The hosted SaaS that runs Aster Lang. Lives at `aster-lang.cloud`. Adds multi-tenant infra, plan tiers, dashboard, AI assistance billing, hosted audit. |
| **Aster Lang Cloud** | Acceptable long-form when context makes "Cloud" ambiguous; prefer plain "Aster Cloud" or just "Cloud" once context is established. |
| **Aster Lang Enterprise** | The self-hosted distribution of the same engine. Acquired through subscription + perpetual fallback license. |

Wrong: "Aster" alone (too ambiguous), "AsterCloud" (no space), "Aster
Language Cloud" (we don't use "Language").

## CTAs

There are exactly four conversion verbs. Use the listed label
verbatim, in your locale. Don't invent new variants.

| Action | Label (en) | Label (zh) | Label (de) | Where it lives |
|---|---|---|---|---|
| Self-serve SaaS signup | **Start free** | **免费开始** | **Kostenlos starten** | Landing primary CTA, pricing Pro tier, dev portal "Open Cloud" alt-text |
| Enterprise / on-prem sales | **Talk to sales** | **联系销售** | **Vertrieb sprechen** | Pricing Enterprise tier, on-prem landing, all enterprise mailto buttons |
| Language eval with no account | **Try Playground** | **打开演练场** | **Spielplatz öffnen** | Dev portal hero, landing CNL demo CTA |
| Documentation | **Read docs** | **阅读文档** | **Doku lesen** | Dev portal nav, footer, in-product help links |

Don't use: "Get Started", "Sign Up Now", "Open the SaaS", "Contact Us",
"Buy", "Subscribe" — every one of these maps onto one of the four
above; pick the right one.

## Email routing

| Address | Use |
|---|---|
| `hello@aster-lang.dev` | Open-source / community / partnership inquiries (dev portal) |
| `sales@aster-lang.cloud` | All commercial sales (Pro + Enterprise) |
| `support@aster-lang.cloud` | Customer support |
| `dpo@aster-lang.cloud` | Privacy officer / DSAR / GDPR |

The `enterprise@aster-lang.dev` address was deprecated 2026-05; route
Enterprise inquiries to `sales@aster-lang.cloud` instead. If you find
references in either repo, please send a PR.
