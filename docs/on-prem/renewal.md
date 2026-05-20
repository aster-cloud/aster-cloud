# License Renewal (Self-Serve)

<!-- glossary:block id=renewal-license-renewal-self-serve-paragraph-1 -->
Aster ships license renewal as a SaaS-hosted portal. On-prem customers
get a renewal-link email 30/14/7/1 days before expiry; the link
takes ops to a single-page Stripe checkout that, on payment success,
issues a fresh signed license + emails it back with deployment-update
instructions.
<!-- /glossary:block -->

<!-- glossary:block id=renewal-license-renewal-self-serve-paragraph-2 -->
This document is for on-prem ops who will receive these emails and
need to know what to expect.
<!-- /glossary:block -->

## Lifecycle

```
T-30d                  T-14d                 T-7d              T-1d         expires
  │                      │                     │                 │             │
  │  renewal email #1    │  email #2           │  email #3       │  email #4   │
  │  with token URL      │  (same flow)        │                 │             │
  ▼                      ▼                     ▼                 ▼             ▼

Ops opens portal → confirms summary → Stripe checkout (one-time payment)
                                          │
                                          ▼
                                  Aster webhook signs new license,
                                  emails ops the new key + ASTER_DEPLOYMENT_ID
                                          │
                                          ▼
                       Ops deploys new env vars, restarts aster-cloud
                                          │
                       ┌──────────────────┼──────────────────┐
                       │ Overlap window (RENEWAL_OVERLAP_DAYS, default 7d) │
                       │ — both old and new licenses verify              │
                       └──────────────────┬──────────────────┘
                                          ▼
                            Old license added to revocation list;
                            on next refresh the old key stops verifying.
```

## What ops needs to do

<!-- glossary:block id=renewal-what-ops-needs-to-do-list-item-3 -->
1. Receive the renewal email (from `licensing@aster-lang.cloud` by default).
<!-- /glossary:block -->
<!-- glossary:block id=renewal-what-ops-needs-to-do-list-item-4 -->
2. Click the portal link — it's valid for 14 days.
<!-- /glossary:block -->
<!-- glossary:block id=renewal-what-ops-needs-to-do-list-item-5 -->
3. Review the license summary (customer / current expiry / deployment label).
<!-- /glossary:block -->
<!-- glossary:block id=renewal-what-ops-needs-to-do-list-item-6 -->
4. Click **Continue to checkout** → completes payment on Stripe.
<!-- /glossary:block -->
<!-- glossary:block id=renewal-what-ops-needs-to-do-list-item-7 -->
5. Wait for the success email (typically <60 seconds after payment).
<!-- /glossary:block -->
<!-- glossary:block id=renewal-what-ops-needs-to-do-list-item-8 -->
6. Update on-prem env:
   ```bash
   LICENSE_KEY=<new key from email>
   # ASTER_DEPLOYMENT_ID is unchanged unless email says otherwise.
   ```
<!-- /glossary:block -->
<!-- glossary:block id=renewal-what-ops-needs-to-do-list-item-9 -->
7. Restart aster-cloud. `/admin/license` should show "verified" within
   60s and the new expiry date.
<!-- /glossary:block -->
<!-- glossary:block id=renewal-what-ops-needs-to-do-list-item-10 -->
8. Confirm everything works during the 7-day overlap. After that the old
   key is auto-revoked.
<!-- /glossary:block -->

## What ops cannot do via self-serve

<!-- glossary:block id=renewal-what-ops-cannot-do-via-self-serve-paragraph-11 -->
These remain sales-managed (contact `sales@aster-lang.cloud`):
<!-- /glossary:block -->

<!-- glossary:block id=renewal-what-ops-cannot-do-via-self-serve-list-item-12 -->
- **Change tier** (enterprise ↔ enterprise-plus). Tier changes require
  procurement review.
<!-- /glossary:block -->
<!-- glossary:block id=renewal-what-ops-cannot-do-via-self-serve-list-item-13 -->
- **Change deployment slug / migrate clusters.** Binding is intentionally
  not transferable through the portal — security-sensitive.
<!-- /glossary:block -->
<!-- glossary:block id=renewal-what-ops-cannot-do-via-self-serve-list-item-14 -->
- **Multiple licenses at once.** One renewal → one license. Bulk renewal
  is a sales conversation.
<!-- /glossary:block -->
<!-- glossary:block id=renewal-what-ops-cannot-do-via-self-serve-list-item-15 -->
- **License recovery** (lost original key). Sales coordinates issuance of
  a replacement after identity check.
<!-- /glossary:block -->

## Configuration on-prem side

<!-- glossary:block id=renewal-configuration-on-prem-side-paragraph-16 -->
Set one extra env to enable the **Renew now** button in `/admin/license`:
<!-- /glossary:block -->

```bash
NEXT_PUBLIC_LICENSE_RENEWAL_PORTAL_URL=https://aster-lang.cloud/renew
```

<!-- glossary:block id=renewal-configuration-on-prem-side-paragraph-17 -->
When unset, the admin page falls back to a `mailto:sales` link.
<!-- /glossary:block -->

## Where the renewal email goes

<!-- glossary:block id=renewal-where-the-renewal-email-goes-paragraph-18 -->
The renewal-warning cron uses the `contactEmail` field on the license
payload (set at sign time by Aster sales) as primary recipient. If that
field is absent or rejected by Resend, the cron logs the portal URL to
the `#licenses-ops` Slack channel as a fallback so ops can forward
manually.
<!-- /glossary:block -->

<!-- glossary:block id=renewal-where-the-renewal-email-goes-paragraph-19 -->
In the SaaS Resend dashboard, renewal email traffic is tagged:
<!-- /glossary:block -->

<!-- glossary:block id=renewal-where-the-renewal-email-goes-paragraph-20 -->
| Tag | Value | Meaning |
|-----|-------|---------|
| `flow` | `license-renewal` | All renewal-related traffic |
| `stage` | `invite` | Pre-payment, contains portal link |
| `stage` | `success` | Post-payment, contains license key |
| `threshold` | `30` / `14` / `7` / `1` | Which warning threshold triggered this invite |
<!-- /glossary:block -->

## What if the renewal email never arrives

<!-- glossary:block id=renewal-what-if-the-renewal-email-never-arrives-list-item-21 -->
- Check spam.
<!-- /glossary:block -->
<!-- glossary:block id=renewal-what-if-the-renewal-email-never-arrives-list-item-22 -->
- The portal token is also recorded in the SaaS admin audit log; ops can
  contact `support@aster-lang.cloud` and reference the license ID — we
  can re-mint a token within minutes (no Stripe state involved).
<!-- /glossary:block -->
<!-- glossary:block id=renewal-what-if-the-renewal-email-never-arrives-list-item-23 -->
- If you already paid but no key arrived: forward the Stripe receipt to
  support. The webhook handler is designed to be safely re-runnable (the
  IssuedLicense row will exist in the SaaS DB; we can re-deliver from there).
<!-- /glossary:block -->

## Configuration on Aster (SaaS) side

<!-- glossary:block id=renewal-configuration-on-aster-saas-side-paragraph-24 -->
These envs control the renewal flow; not customer-visible.
<!-- /glossary:block -->

<!-- glossary:block id=renewal-configuration-on-aster-saas-side-paragraph-25 -->
| Env | Purpose |
|-----|---------|
| `LICENSE_SIGNING_API_URL` | base URL of aster-deploy signing-api |
| `LICENSE_SIGNING_KEY_ID` | Vault Transit key id to sign with |
| `BILLING_JWT_ISSUER` / `BILLING_JWT_AUDIENCE` | distinct OIDC issuer for service-account JWTs (separate from human ceremony JWTs) |
| `BILLING_OPERATOR_SUB` / `BILLING_WITNESS_SUB` | the two svc account subs |
| `BILLING_OPERATOR_PRIVATE_KEY_PKCS8` / `BILLING_WITNESS_PRIVATE_KEY_PKCS8` | PKCS8 PEM for mint-time JWT signing |
| `BILLING_OPERATOR_KID` / `BILLING_WITNESS_KID` | JWT kid hints for JWKS resolution |
| `STRIPE_RENEWAL_PRICE_ENTERPRISE_ANNUAL` etc. | price ID lookup by tier+term |
| `RENEWAL_EMAIL_FROM` | "From" address for renewal emails |
| `RENEWAL_OVERLAP_DAYS` | how long old license stays valid after renewal (default 7) |
| `LICENSE_RENEWAL_WARN_DAYS` | csv of warning thresholds in days (default 30,14,7,1) |
| `LICENSES_SLACK_WEBHOOK` | optional, ops audit channel |
| `NEXT_PUBLIC_APP_URL` | base for the portal URL embedded in emails |
<!-- /glossary:block -->

Cron jobs:

<!-- glossary:block id=renewal-configuration-on-aster-saas-side-list-item-26 -->
- `POST /api/cron/license-renewal-token-mint` — daily; scans
  `IssuedLicense` for upcoming expirations and mints tokens.
<!-- /glossary:block -->
<!-- glossary:block id=renewal-configuration-on-aster-saas-side-list-item-27 -->
- `POST /api/cron/license-renewal-overlap-expiry` — daily; revokes
  superseded licenses once their overlap window closes.
<!-- /glossary:block -->

<!-- glossary:block id=renewal-configuration-on-aster-saas-side-paragraph-28 -->
Both gated by `CRON_SECRET` (`Authorization: Bearer ${secret}`).
<!-- /glossary:block -->
