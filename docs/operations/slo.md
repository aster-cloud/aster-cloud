# Service Level Objectives (SLOs)

Quantitative targets for production reliability. Measured monthly. Public commitments to customers should be 1-2 nines lower than internal targets — we want internal alarms before customers notice.

## SLI definitions

A Service Level Indicator (SLI) is a metric we measure. Each SLO is `SLI ≥ threshold` for `≥ X% of time in window`.

| ID | SLI | How measured |
|---|---|---|
| **A1** | Dashboard availability | `1 - rate(5xx[5m]) / rate(all_requests[5m])` for `aster-lang.cloud/dashboard*` |
| **A2** | /api/v1/policies/evaluate p99 latency | `histogram_quantile(0.99, rate(evaluate_duration_ms_bucket[5m]))` |
| **A3** | /api/v1/policies/evaluate-source p99 latency | same, evaluate-source bucket |
| **A4** | NextAuth session establishment | `rate(auth_callback_success[5m]) / rate(auth_callback_attempt[5m])` |
| **A5** | /admin write-operation success | when license gate is NOT triggered, write rate / write attempt rate |
| **A6** | Stripe webhook idempotent processing | `rate(stripe_webhook_acked[5m]) / rate(stripe_webhook_received[5m])` |
| **A7** | License revocation refresh success | `rate(license_revocation_refresh_success[1h]) / rate(license_revocation_refresh_total[1h])` |

## SLO targets

### Internal targets (alarms fire before these breach)

| SLO | Window | Target |
|---|---|---|
| A1 — Dashboard availability | 30 day rolling | ≥ 99.9% (43 min downtime/month) |
| A2 — /evaluate p99 | 5 min rolling | < 100 ms |
| A3 — /evaluate-source p99 | 5 min rolling | < 1000 ms |
| A4 — Login success rate | 30 day rolling | ≥ 99.5% (rest = wrong-password etc., not our fault) |
| A5 — Admin write success | 30 day rolling | ≥ 99.9% (license-gated states excluded from denominator) |
| A6 — Stripe idempotency | 30 day rolling | 100% (zero tolerance — billing must match Stripe state) |
| A7 — Revocation refresh | 7 day rolling | ≥ 95% (on-prem grace window is 7 days, so this is the safety budget) |

### Customer-facing commitment

We publish to the status page:

| Customer-facing SLO | Window | Stated target |
|---|---|---|
| Site availability | 30 day rolling | ≥ 99.5% |
| Policy execution p99 | 5 min rolling | < 200 ms |
| Login | 30 day rolling | ≥ 99% |

Internal targets are tighter so the alarm fires before the customer-facing one breaches.

## Error budget

For each SLO, the error budget is `(1 - target) × window_minutes`. Burn it on:
- Real incidents (acceptable)
- Planned deploys (acceptable if minimal)
- Bad luck (acceptable but learn)

Don't burn it on:
- Avoidable regressions (file post-mortem, fix the gap)
- Repeated small failures of the same type (file an issue)

### Burn-rate alerting

We page on **fast burn** (2 hours of error budget consumed in 1 hour). Slack-only notification on **slow burn** (24 hours consumed in 24h).

Burn rate formulas (Prometheus):

```promql
# Fast burn (1h window, alert if budget burn > 14.4× normal):
(
  sum(rate(http_requests_total{status=~"5.."}[1h]))
  /
  sum(rate(http_requests_total[1h]))
) > (1 - 0.999) * 14.4

# Slow burn (24h window, alert if burn > 6× normal):
(
  sum(rate(http_requests_total{status=~"5.."}[24h]))
  /
  sum(rate(http_requests_total[24h]))
) > (1 - 0.999) * 6
```

These thresholds come from the standard multi-window burn-rate pattern (SRE workbook Ch. 5).

## Computing monthly SLO compliance

End of each month, the on-call rotation lead produces a one-page summary:

```
SLO     Target    Actual    Met?    Error budget used    Remaining
A1      99.9%     99.97%    YES     30 of 43 min         13 min
A2      <100ms    p99=89ms  YES     n/a
A3      <1000ms   p99=120ms YES     n/a
A4      99.5%     99.6%     YES     ...
A5      99.9%     99.85%    NO ⚠️   ...                  ...
A6      100%      100%      YES     n/a
A7      95%       96.2%     YES     ...
```

Posted to #ops at month boundary. SLOs not met → file an action plan, not a post-mortem (the latter is per-incident).

## Tuning SLOs

Re-evaluate quarterly. Signals to adjust:

- **Consistent over-attainment** (e.g. A2 always < 30ms but target is 100ms) → tighten the target, the headroom is wasted
- **Consistent breaches** → either fix the underlying performance issue, OR explicitly weaken the SLO with customer notification
- **New feature class** (e.g. AI streaming) → add a new SLI / SLO; don't retrofit existing ones to "fit" the new shape

## What's NOT an SLO

- **Page load time including 3rd party scripts** — can't control Stripe/Mixpanel ourselves
- **Email deliverability** — Resend has its own SLO; we monitor via their dashboard
- **Customer's internal NPS** — that's a product metric, not an availability metric
- **Build time / CI green rate** — engineering hygiene, not customer-facing

## Related runbooks

- [`incident-response.md`](../runbooks/incident-response.md) — what to do when an SLO threatens to breach
- [`post-mortem-template.md`](../runbooks/post-mortem-template.md) — for any incident burning more than 25% of monthly error budget
- [`uptime-monitoring.md`](uptime-monitoring.md) — third-party monitors that drive the SLO measurements
