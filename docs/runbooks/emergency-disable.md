# Emergency user / tenant disable

When you need to immediately stop a user or tenant from causing damage — abuse, security breach, runaway billing, court order. Each procedure must leave a paper trail.

## Decision tree

```
Is the offender …
│
├─ A single user account?
│  → Section A (user-level disable)
│
├─ All users under one team / tenant?
│  → Section B (tenant-level disable)
│
├─ All users from one geographic region / IP range?
│  → Section C (network-level disable)
│
└─ Aster itself (security policy violation, takedown notice)?
   → Section D (kill switch)
```

## A. User-level disable

Affects: one User row. Other users untouched.

### Step 1 — Disable login (immediate effect within 60s, next request blocked)

```bash
psql "$DATABASE_URL" <<SQL
-- Soft-delete: keeps audit trail, blocks new sessions
UPDATE "User"
SET "deletedAt" = NOW(),
    "deletedReason" = 'emergency-disable',
    "deletedBy" = '<your-admin-user-id>'
WHERE id = '<offender-user-id>';

-- Also force-invalidate active session tokens (NextAuth JWT)
UPDATE "Session"
SET "expiresAt" = NOW()
WHERE "userId" = '<offender-user-id>';
SQL
```

### Step 2 — Disable API keys (if they have any)

```bash
psql "$DATABASE_URL" <<SQL
UPDATE "ApiKey"
SET "revokedAt" = NOW(),
    "revokedReason" = 'emergency-disable'
WHERE "userId" = '<offender-user-id>';

UPDATE "AiKeyBinding"
SET active = false
WHERE "userId" = '<offender-user-id>';
SQL
```

### Step 3 — Cancel Stripe subscription (if billing involved)

```bash
# Look up Stripe customer ID for this user
psql "$DATABASE_URL" -c "SELECT \"stripeCustomerId\" FROM \"User\" WHERE id='<id>';"

# Cancel via Stripe CLI
stripe subscriptions list --customer cus_xxx --limit 5 | jq '.data[].id'
stripe subscriptions cancel sub_xxx --invoice-now=false
```

### Step 4 — Audit log

```bash
psql "$DATABASE_URL" -c "
  INSERT INTO \"AuditLog\" (\"id\", \"action\", \"actor\", \"target\", \"reason\", \"at\")
  VALUES (gen_random_uuid(), 'emergency-user-disable',
          '<your-admin-user-id>', '<offender-user-id>',
          '<reason — abuse / security / court order / etc>', NOW());
"
```

### Recovery (if disabled by mistake)

```bash
psql "$DATABASE_URL" <<SQL
UPDATE "User" SET "deletedAt"=NULL, "deletedReason"=NULL, "deletedBy"=NULL
WHERE id = '<offender-user-id>';

UPDATE "ApiKey" SET "revokedAt"=NULL, "revokedReason"=NULL
WHERE "userId" = '<offender-user-id>' AND "revokedReason"='emergency-disable';

UPDATE "AiKeyBinding" SET active=true
WHERE "userId" = '<offender-user-id>';
SQL
```

## B. Tenant-level disable

Affects: all users under a single Team (= tenant). For B2B abuse, contract termination.

### Step 1 — Mark the team disabled

```bash
psql "$DATABASE_URL" <<SQL
UPDATE "Team"
SET "deletedAt" = NOW(),
    "deletedReason" = 'emergency-tenant-disable',
    "deletedBy" = '<your-admin-user-id>'
WHERE id = '<offender-team-id>';
SQL
```

### Step 2 — Disable all member sessions

```bash
psql "$DATABASE_URL" <<SQL
-- Block sessions for everyone in this team
UPDATE "Session"
SET "expiresAt" = NOW()
WHERE "userId" IN (
  SELECT "userId" FROM "TeamMember" WHERE "teamId" = '<offender-team-id>'
);
SQL
```

### Step 3 — Disable team API keys

```bash
psql "$DATABASE_URL" <<SQL
UPDATE "ApiKey" SET "revokedAt"=NOW(), "revokedReason"='emergency-tenant-disable'
WHERE "teamId" = '<offender-team-id>';
SQL
```

### Step 4 — Audit + notification

```bash
# Audit log entry (per A.4)
# + send email via Resend to ALL team members:
psql "$DATABASE_URL" -c "
  SELECT u.email
  FROM \"User\" u
  JOIN \"TeamMember\" tm ON tm.\"userId\" = u.id
  WHERE tm.\"teamId\" = '<offender-team-id>';
" -t -A | xargs -I {} curl -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from":"...","to":"{}","subject":"...","html":"..."}'
```

## C. Network-level disable

Affects: all requests from specific IP / IP range / country. Used for DDoS, scraping, sanctions compliance.

This is **NOT** a Postgres procedure — it's a Cloudflare WAF rule.

```bash
# Block a single IP for 1 hour (auto-expires)
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/firewall/rules" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filter": {
      "expression": "(ip.src eq <attacker-ip>)"
    },
    "action": "block",
    "description": "emergency-block-incident-12345",
    "paused": false
  }'

# Block a country (use ISO 3166-1 alpha-2 code)
# expression: '(ip.geoip.country eq "XX")'

# For sanctions enforcement, use the firewall managed list:
# https://dash.cloudflare.com/?to=/:account/:zone/security/waf
```

**Important**: Don't block your own ops IPs by accident. Test the expression against a single fake IP first using Cloudflare's dashboard "Test" mode.

## D. Aster-wide kill switch

Affects: everyone. Use only for true emergencies — security breach, court order, legal takedown.

```bash
# Step 1: Set the read-only platform flag (cuts off writes globally)
psql "$DATABASE_URL" -c "
  INSERT INTO \"PlatformSetting\" (key, value, \"updatedBy\")
  VALUES ('platform.read_only.enabled', 'true'::json, '<admin-id>')
  ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, \"updatedAt\"=NOW();
"

# Step 2: Notify customers via status page
#   https://status.aster-lang.cloud/ → "Maintenance in progress"

# Step 3: If full takedown needed, deploy a "site under maintenance" Worker:
#   The wrangler/static-page deploy lives in scripts/maintenance-page.js
wrangler deploy scripts/maintenance-page.js --name aster-cloud
```

Recovery: reverse the `PlatformSetting` flag, redeploy the normal Worker.

## Always

- **Audit log every action**: who did it, when, what target, what reason
- **Two-person rule** for D (kill switch) — require sign-off from a second admin
- **Customer comms** within 1 hour of any tenant-level or wider action
- **Post-mortem** within 72 hours for any emergency disable
- **Recovery plan documented** before you press the button — know how to undo if you were wrong

## Never

- **Hard-delete** rows. Always soft-delete (set `deletedAt`). Hard-delete loses the audit trail.
- **Disable without documenting** the reason. Future-you reviewing the audit log will hate present-you for "reason: abuse" with no link to evidence.
- **Disable yourself accidentally** — verify you're not in the team-member list before running tenant-level disable.
- **Use Cloudflare network blocks for legitimate disputes**. Use the legal/billing channel; network blocks are for live attacks only.
