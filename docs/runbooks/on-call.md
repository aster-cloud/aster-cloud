# On-call rotation guide

## Cadence

- **Primary**: one engineer per week, Monday 09:00 AEST → next Monday 09:00 AEST
- **Secondary**: second engineer, same window, paged if primary doesn't ack within 15 min
- **Escalation**: head of engineering, paged if both primary + secondary don't ack within 30 min

## Pager hours

| Severity | Page hours | Examples |
|---|---|---|
| **P0** | 24×7 | site fully down, data loss, security breach |
| **P1** | 24×7 | major feature broken, >5% error rate, customer-facing |
| **P2** | business hours only | minor regression, single-customer issue, performance degraded |
| **P3** | next business day | cosmetic, internal-only, low-impact |

If you can't tell the severity within 30s, treat it as P0 — over-pager is recoverable, under-pager is not.

## Handoff checklist

Outgoing on-call hands off to incoming on-call at the rotation boundary. 15-minute call, scheduled.

- [ ] Walk through open incidents (status page, internal channel)
- [ ] Walk through open dependabot PRs that need review (#dependencies channel)
- [ ] Flag any "watch this" signal: a customer who reported flakiness, a metric trending wrong
- [ ] Verify incoming has access to:
  - PagerDuty (mobile app + browser)
  - Cloudflare dashboard
  - OCI console (for ArgoCD / staging)
  - Production Grafana
  - 1Password vault `aster-prod-ops`
  - #ops Slack channel + #incident-* channels
  - GitHub admin access (for emergency disable, secret rotation)
- [ ] Confirm incoming knows where the runbooks are (`docs/runbooks/`)
- [ ] Mention any known fragile areas this week (e.g. "deploy freeze Friday afternoon due to investor demo")

## During the rotation

### Daily

- 09:00 AEST: scan Cloudflare logs from last 24h for anomalies (`wrangler tail --since 24h | grep ERROR`)
- 09:15 AEST: glance at Grafana dashboards: prod overview, license dashboard, AI usage
- 09:30 AEST: triage #support channel; ack tickets with "looking into this"
- 09:45 AEST: review any dependabot PRs that merged overnight; verify no regressions

### Weekly

- Monday: review previous week's incidents; verify action items from any post-mortems are tracked
- Wednesday: review backlog of `#low-priority-ops` items; pick one to close
- Friday: write a brief end-of-week summary in #ops covering: incidents handled, metrics anomalies, customer escalations, things to watch

## When paged

1. **Ack within 5 min** even if you're not at a keyboard. "On it, 10 min" buys time.
2. **Open the incident channel**: `/incident open <slug>` if you have a slash command, else just create `#incident-YYYYMMDD-<slug>` manually.
3. **Follow** [`incident-response.md`](incident-response.md) for the matching scenario.
4. **Communicate every 15 minutes** in the incident channel, even if "still investigating". Silence panics customers.
5. **Update status page** within 10 minutes if customer-facing.
6. **Page secondary** if you need a second pair of eyes — there's no medal for solo heroism.

## After resolution

- File post-mortem via [`post-mortem-template.md`](post-mortem-template.md) within 72 hours
- Verify action items get tracked as issues
- Run a 30-min "monitoring afterwards" check — relapse is real
- Close the incident channel (don't delete; archives for future reference)

## Out-of-rotation responsibilities

When NOT on call:

- Available for paging into escalation (secondary, head of eng)
- Available to review post-mortems written by current on-call
- NOT expected to monitor channels or fix issues unsupervised
- Should resist the urge to "just fix this real quick" — that breaks the rotation discipline

## Handoff template

Paste in the rotation Slack channel each Monday 09:00 AEST.

```
*On-call handoff: <outgoing> → <incoming>*

Open items:
- <link to GH issue or channel>: brief context, current status

Things to watch:
- <e.g. "customer X reported intermittent flakiness on Friday; not reproduced yet">

Recent deploys:
- aster-cloud: <last deploy time + commit>
- aster-api:   <last deploy time + commit + ArgoCD app sync status>

Outstanding dependabot:
- <count> PRs open; <count> grouped batches

Calendar notes:
- <e.g. "I'll be unreachable Wednesday 14:00-17:00 AEST; escalation goes
  directly to <other person>">

Tag: @<incoming-on-call>
```
