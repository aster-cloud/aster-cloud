# Post-mortem template

Copy this file to `docs/runbooks/post-mortems/YYYY-MM-DD-<slug>.md` within 72 hours of incident resolution.

Format follows the [SRE blameless post-mortem](https://sre.google/sre-book/postmortem-culture/) pattern: facts first, attribution to systems not people, action items with owners and dates.

---

# Post-mortem: <one-line summary>

| | |
|---|---|
| **Incident date** | YYYY-MM-DD |
| **Duration** | NN minutes |
| **Severity** | P0 / P1 / P2 |
| **Customer impact** | <users affected, what they couldn't do> |
| **Detected by** | <alert / customer report / on-call observation> |
| **Detection lag** | <minutes between start and detection> |
| **Resolution lag** | <minutes between detection and recovery> |
| **Author** | <name> |
| **Reviewer** | <name, not the author> |
| **Status** | Draft / In review / Final |

## Summary

Two or three sentences. What broke, who noticed, how it was fixed. No jargon — this paragraph is for executives and customers reading the public version.

## Timeline

UTC timestamps, one event per line. Include detection, response actions, communication events, recovery.

```
14:28  Deploy commit abc123def to aster-cloud Workers (rolled out by CI)
14:31  First 5xx response observed in Cloudflare logs (one user)
14:33  Pingdom alert fires for aster-lang.cloud /
14:34  On-call paged via PagerDuty
14:36  On-call confirms 5xx spike, opens #incident-12345 channel
14:38  Status page → "Investigating"
14:41  Identified abc123def as suspect; ran wrangler rollback
14:43  Rollback deploy starts
14:46  Rollback complete; 5xx rate falling
14:50  Status page → "Resolved"
15:15  Verified clean for 25 min; #incident-12345 closed
```

## Impact

- **Users affected**: <count, % of total>
- **Requests affected**: <count of 5xx responses>
- **Customer dollars at risk**: <if known, e.g. failed payment processing>
- **Data integrity**: <was any data lost? written incorrectly?>
- **Reputation**: <social media reports, support tickets opened>

## Root cause

What broke, technically. Trace from the user-visible symptom back through layers to the originating change or condition.

Example:
> A commit introduced a typo in the middleware redirect handler that returned `307` with a `Location` header pointing to the same path the request came in on. On Cloudflare Workers the redirect loop terminates after browser caps; on Node standalone (used by on-prem) it does not, so on-prem deployments would have looped indefinitely. SaaS users saw 5xx because Cloudflare cached the bad redirect for 5 seconds before evicting.

Do NOT attribute to a person. Attribute to the system or process: "the linter didn't catch X", "the e2e suite didn't cover Y", "the staging soak time was 0 minutes".

## What went well

- <e.g. detection alert fired within 3 minutes of first bad response>
- <e.g. rollback procedure worked first time>
- <e.g. customer comms went out within 10 minutes>

## What went badly

- <e.g. detection lag was 3 minutes; we should have caught it in 30 seconds>
- <e.g. rollback procedure was unclear, on-call took 5 min to find the wrangler command>
- <e.g. status page was 12 min late>

## Action items

Each item has: **owner, deadline, link to issue**. Verify within 30 days that each is done.

| # | Action | Owner | Due | Issue |
|---|---|---|---|---|
| 1 | Add a unit test that catches a same-URL redirect | <name> | 2026-MM-DD | #1234 |
| 2 | Add the wrangler-rollback command to the IR runbook with a TLDR at the top | <name> | 2026-MM-DD | #1235 |
| 3 | Tune Pingdom check interval from 60s to 30s | <name> | 2026-MM-DD | #1236 |

## Lessons learned

A few paragraphs of reflection. What would we do differently? What about this incident surprised us? What should the next engineer joining the team understand from this?

This section is for future-us. Don't dilute it with feel-good summaries — be specific.

## Customer-facing summary

A 2-3 paragraph version of "Summary" suitable for posting to the public status page or sending to a customer who asks. Avoid internal jargon, no acronyms without expansion.

---

## Reviewer checklist

- [ ] Author is NOT a primary actor in the incident (different person reviews)
- [ ] All timestamps are UTC and verified against the source (logs, alerts)
- [ ] No attribution to individuals; all attribution is to systems / process
- [ ] Action items have owners and dates, not "TBD"
- [ ] Action items are tracked as issues (linked in the table)
- [ ] Customer-facing summary doesn't reveal sensitive operational details
