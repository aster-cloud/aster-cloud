# License Renewal (Self-Serve)

Aster ships license renewal as a SaaS-hosted portal. On-prem customers
get a renewal-link email 30/14/7/1 days before expiry; the link
takes ops to a single-page Stripe checkout that, on payment success,
issues a fresh signed license + emails it back with deployment-update
instructions.

This document is for on-prem ops who will receive these emails and
need to know what to expect.

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

1. Receive the renewal email (from `licensing@aster-lang.cloud` by default).
2. Click the portal link — it's valid for 14 days.
3. Review the license summary (customer / current expiry / deployment label).
4. Click **Continue to checkout** → completes payment on Stripe.
5. Wait for the success email (typically <60 seconds after payment).
6. Update on-prem env:
   ```bash
   LICENSE_KEY=<new key from email>
   # ASTER_DEPLOYMENT_ID is unchanged unless email says otherwise.
   ```
7. Restart aster-cloud. `/admin/license` should show "verified" within
   60s and the new expiry date.
8. Confirm everything works during the 7-day overlap. After that the old
   key is auto-revoked.

## What ops cannot do via self-serve

These remain sales-managed (contact `sales@aster-lang.cloud`):

- **Change tier** (enterprise ↔ enterprise-plus). Tier changes require
  procurement review.
- **Change deployment slug / migrate clusters.** Binding is intentionally
  not transferable through the portal — security-sensitive.
- **Multiple licenses at once.** One renewal → one license. Bulk renewal
  is a sales conversation.
- **License recovery** (lost original key). Sales coordinates issuance of
  a replacement after identity check.

## Configuration on-prem side

Set one extra env to enable the **Renew now** button in `/admin/license`:

```bash
NEXT_PUBLIC_LICENSE_RENEWAL_PORTAL_URL=https://aster-lang.cloud/renew
```

When unset, the admin page falls back to a `mailto:sales` link.

## Where the renewal email goes

The renewal-warning cron uses the `contactEmail` field on the license
payload (set at sign time by Aster sales) as primary recipient. If that
field is absent or rejected by Resend, the cron logs the portal URL to
the `#licenses-ops` Slack channel as a fallback so ops can forward
manually.

In the SaaS Resend dashboard, renewal email traffic is tagged:

| Tag | Value | Meaning |
|-----|-------|---------|
| `flow` | `license-renewal` | All renewal-related traffic |
| `stage` | `invite` | Pre-payment, contains portal link |
| `stage` | `success` | Post-payment, contains license key |
| `threshold` | `30` / `14` / `7` / `1` | Which warning threshold triggered this invite |

## What if the renewal email never arrives

- Check spam.
- The portal token is also recorded in the SaaS admin audit log; ops can
  contact `support@aster-lang.cloud` and reference the license ID — we
  can re-mint a token within minutes (no Stripe state involved).
- If you already paid but no key arrived: forward the Stripe receipt to
  support. The webhook handler is designed to be safely re-runnable (the
  IssuedLicense row will exist in the SaaS DB; we can re-deliver from there).

## Configuration on Aster (SaaS) side

These envs control the renewal flow; not customer-visible.

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

Cron jobs:

- `POST /api/cron/license-renewal-token-mint` — daily; scans
  `IssuedLicense` for upcoming expirations and mints tokens.
- `POST /api/cron/license-renewal-overlap-expiry` — daily; revokes
  superseded licenses once their overlap window closes.

Both gated by `CRON_SECRET` (`Authorization: Bearer ${secret}`).
