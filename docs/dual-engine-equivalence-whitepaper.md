# Two engines, one answer
## How Aster proves a credit decision is reproducible — a white paper for risk & compliance

**Audience:** heads of credit risk, model governance, and compliance.
**Version:** 1.0 · 2026-06-12 · Aster Lang v1.0.0
**What this is:** a plain-language explanation of *why* you can trust the decisions
Aster produces, backed by published, re-runnable measurements — not marketing claims.

---

## 1. The problem you actually have

When a regulator, an auditor, or a declined customer asks **"how was this decision made?"**,
most lending stacks can't give a clean answer. The rule may have changed. The data may
have changed. The code path may have changed. Engineers end up *reconstructing* what
probably happened — which is not the same as *proving* what did happen.

For credit decisions, that gap is not academic. Adverse-action explainability is a
legal obligation in most markets, and "we think it was denied because…" is not a defensible
position in an examination.

Aster is built so the answer is always available and always exact: **pull the exact rule
version and inputs from the moment of the decision, and recompute the identical result.**
Not a log entry — the real path. We call this *replay*.

But replay only means something if you can trust **the engine that recomputes** is correct.
That is what this paper is about.

---

## 2. What "dual-engine equivalence" means (in one paragraph)

Aster ships **two completely independent execution engines** built by different toolchains:

- a **Java engine** (compiled, runs on the GraalVM/Truffle runtime), used in the backend;
- a **TypeScript engine** (runs in the browser and in Node), used for previews and offline checks.

They were implemented separately — different parsing technology, different code, different
authors. For every rule and every input, **both engines must produce the byte-for-byte
identical result.** If they ever disagreed, that disagreement would be a loud, automated
failure — and a release would be blocked.

Why this matters to you: a single engine can be subtly wrong and *nobody would know* — the
wrong answer looks just as confident as the right one. Two independent engines that always
agree is a continuous, automated cross-check. It turns "trust our implementation" into
"two independent implementations confirm each other, on every change."

This is the same principle as dual-control in finance: you don't trust one signer; you
require two independent ones to agree.

---

## 3. The evidence (measured, not asserted)

These numbers are produced by an automated test suite on every change and published openly.
You can see the live figures and trend at **aster-lang.cloud/equivalence**, and the raw
data and test harness in the public `aster-lang-test` repository.

| Layer of agreement | Result | What it proves |
|---|---|---|
| **Acceptance (parse)** | **208 / 208** identical | Both engines read the same rule the same way — zero ambiguity in what the rule *says*. |
| **Execution (eval)** | **239 / 239** byte-for-byte identical | Both engines compute the same decision for the same inputs — zero disagreement in what the rule *does*. This is the strong one. |
| **Internal form (IR)** | **203 / 203** structurally identical | Both engines reduce the rule to the same internal logic before running it. |
| **Execution coverage** | **132 / 132** (100%) | Every runnable rule in the test corpus is actually executed and checked on both engines — not just parsed. |
| **Feature coverage** | **49 / 49** (100%) | Every non-experimental language feature is exercised by the equivalence suite. |

**Zero divergences at the execution layer.** Every change that would introduce one is caught
before it can ship — the parse-level check is a hard, release-blocking gate in three separate
repositories.

> A note on honesty: we publish a **divergence ledger** (`DIVERGENT-MANIFEST.md`,
> `IR-DIVERGENCE-LEDGER.md`) that records every case where the engines ever differed, the
> root cause, and the fix. We also mark which checks are release-blocking versus report-only.
> The internal-form (IR) comparison has a small number of *representation-level* items that
> are tracked openly and do not affect the decision output. We would rather you see the full
> picture than a polished one — auditors trust ledgers, not adjectives.

---

## 4. Worked example: a declined loan

Consider this credit-approval rule (Aster's controlled English — readable by your team,
not just engineers):

```
Rule decide given applicant as Applicant, produce Text:
  Let dtiRatio be applicant.monthlyDebt divided by applicant.monthlyIncome.
  If applicant.creditScore at least 740 and dtiRatio at most 0.35:
    Return "Approved — premium rate".
  Otherwise:
    If applicant.creditScore at least 660 and dtiRatio at most 0.43:
      Return "Approved — standard rate".
    Otherwise:
      If applicant.creditScore at least 600:
        Return "Refer to manual underwriting".
      Otherwise:
        Return "Declined — credit score below threshold".
```

An applicant with credit score 561 is **declined**. Six months later, the regulator asks why.

With Aster, you replay decision `APP-10561`:

1. **dtiRatio = 1640 ÷ 4100 = 0.40**
2. `creditScore ≥ 740 and dtiRatio ≤ 0.35` → `561 ≥ 740` ✗ → false
3. `creditScore ≥ 660 and dtiRatio ≤ 0.43` → `561 ≥ 660` ✗ → false
4. `creditScore ≥ 600` → `561 ≥ 600` ✗ → false
5. **Return "Declined — credit score below threshold"**

This is recomputed from the **exact rule version and inputs in force at decision time**, and
the result is verified identical across both engines. You are not showing the auditor a guess
or a log line — you are showing them the decision being made again, deterministically, in
front of them.

(You can run this exact scenario at **aster-lang.cloud/demo**.)

---

## 5. What this buys you

- **Adverse-action defensibility.** Any decision — approve, refer, decline — can be replayed
  step-by-step from the governing rule version. The explanation is the computation, not a
  narrative reconstruction.
- **Change governance.** Rules are versioned and approval-gated. The version that ran in
  production is verifiable as the version that was approved — not a hand-edited drift.
- **Independent assurance, continuously.** Two engines agreeing on every change is an
  always-on control, not a point-in-time audit. It does not degrade between reviews.
- **Readable by the people accountable.** Rules are written in controlled English (also
  中文, Deutsch), so risk and compliance can read and sign off on the actual logic — not a
  translation an engineer assures them is faithful.

---

## 6. Scope, limits, and honesty

- **What equivalence proves:** that the two engines agree on accepting, internally
  representing, and executing the language's stable feature set. It does **not** claim the
  *rules you write* are correct — that is your policy's job; Aster guarantees the *engine*
  executes them faithfully and reproducibly.
- **Stable vs. experimental.** Aster v1.0.0 freezes a **Stable** language subset (declarations,
  statements, all operators, the standard library, type aliases) under a 1.x compatibility
  commitment. Asynchronous workflows, the effect system, and cross-module references are
  marked **Experimental** and are out of scope for the equivalence guarantee until frozen.
- **Coverage is honest, not inflated.** The 100% figures are against a defined corpus with
  explicit, documented exemptions (e.g. asynchronous and effect-bearing features that have no
  deterministic golden output). The exemptions are listed, not hidden.
- **The data is yours to re-run.** Everything here is reproducible from the public
  `aster-lang-test` repository. We invite your team — or your auditor — to run it.

---

## 7. One sentence

> Aster runs your credit rules on two independently built engines that must agree on every
> decision, byte for byte, on every change — so when someone asks how a decision was made,
> you replay it and prove it, instead of reconstructing it and hoping.

---

*Figures in this document reflect Aster Lang v1.0.0 as measured on 2026-06-10. Live figures:
aster-lang.cloud/equivalence. Test harness and divergence ledgers: github.com/aster-cloud/aster-lang-test.
This paper is a plain-language summary for risk and compliance stakeholders; a technical
companion (engine architecture, IR normalization, golden-case methodology) is available for
architecture review.*
