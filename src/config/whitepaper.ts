// 双引擎等价白皮书内容（en/zh/de），供 /equivalence/whitepaper 页面渲染 + 浏览器打印 PDF。
//
// 内容来源：docs/dual-engine-equivalence-whitepaper.md（英文权威版），此处结构化为
// 可渲染段落并完整本地化为中文、德文，与 /demo 的三语一致性原则保持统一。
// 图表/实时数字仍以 /equivalence 为准；本白皮书引用 v1.0.0 测量快照 + 指向实时页。

export type WhitepaperLocale = 'en' | 'zh' | 'de';

export function toWhitepaperLocale(locale: string): WhitepaperLocale {
  const l = locale.toLowerCase();
  if (l.startsWith('zh')) return 'zh';
  if (l.startsWith('de')) return 'de';
  return 'en';
}

/** 一段证据表格行。 */
export interface EvidenceRow {
  layer: string;
  result: string;
  proves: string;
}

/** 「值得拥有的回报」要点。 */
export interface Benefit {
  title: string;
  body: string;
}

export interface WhitepaperContent {
  /** 文档元信息 */
  meta: {
    title: string;
    subtitle: string;
    audienceLabel: string;
    audience: string;
    versionLabel: string;
    version: string;
    whatLabel: string;
    what: string;
    downloadPdf: string;
    printHint: string;
    backToEquivalence: string;
  };
  problem: { heading: string; paras: string[] };
  meaning: { heading: string; paras: string[] };
  evidence: {
    heading: string;
    intro: string;
    colLayer: string;
    colResult: string;
    colProves: string;
    rows: EvidenceRow[];
    zeroDivergence: string;
    honestyNote: string;
  };
  example: {
    heading: string;
    intro: string;
    ruleCode: string; // 规则代码块（按语言本地化标识符/关键词，与 /demo 一致）
    declinedLead: string;
    steps: string[];
    closing: string;
    tryAt: string;
  };
  buys: { heading: string; items: Benefit[] };
  scope: { heading: string; items: Benefit[] };
  oneSentence: { heading: string; body: string };
  footer: string;
}

// 规则代码块——复用 /demo 的三语本地化形态（标识符也本地化）。
const RULE_EN = `Rule decide given applicant as Applicant, produce Text:
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
        Return "Declined — credit score below threshold".`;

const RULE_ZH = `规则 评估 给定 申请人 作为 申请人 产出 文本：
  令 负债比 定义为 申请人.月负债 除以 申请人.月收入。
  如果 申请人.信用分 至少 740 并且 负债比 至多 0.35：
    返回 "批准 — 优惠利率"。
  否则：
    如果 申请人.信用分 至少 660 并且 负债比 至多 0.43：
      返回 "批准 — 标准利率"。
    否则：
      如果 申请人.信用分 至少 600：
        返回 "转人工审核"。
      否则：
        返回 "拒绝 — 信用分低于门槛"。`;

const RULE_DE = `Regel entscheiden gegeben antrag als Antragsteller liefert Text:
  sei quote gleich antrag.schulden geteilt durch antrag.einkommen.
  wenn antrag.score mindestens 740 und quote höchstens 0.35:
    gib zurück "Genehmigt — Vorzugszins".
  sonst:
    wenn antrag.score mindestens 660 und quote höchstens 0.43:
      gib zurück "Genehmigt — Standardzins".
    sonst:
      wenn antrag.score mindestens 600:
        gib zurück "Zur Einzelfallprüfung".
      sonst:
        gib zurück "Abgelehnt — Bonität unter Schwellenwert".`;

export const WHITEPAPER: Record<WhitepaperLocale, WhitepaperContent> = {
  en: {
    meta: {
      title: 'Two engines, one answer',
      subtitle: 'How Aster proves a credit decision is reproducible — a white paper for risk & compliance',
      audienceLabel: 'Audience',
      audience: 'Heads of credit risk, model governance, and compliance.',
      versionLabel: 'Version',
      version: '1.0 · 2026-06-12 · Aster Lang v1.0.0',
      whatLabel: 'What this is',
      what: 'A plain-language explanation of why you can trust the decisions Aster produces, backed by published, re-runnable measurements — not marketing claims.',
      downloadPdf: 'Download PDF',
      printHint: 'Opens your browser print dialog — choose “Save as PDF”.',
      backToEquivalence: 'Back to live equivalence figures',
    },
    problem: {
      heading: '1. The problem you actually have',
      paras: [
        'When a regulator, an auditor, or a declined customer asks “how was this decision made?”, most lending stacks can’t give a clean answer. The rule may have changed. The data may have changed. The code path may have changed. Engineers end up reconstructing what probably happened — which is not the same as proving what did happen.',
        'For credit decisions, that gap is not academic. Adverse-action explainability is a legal obligation in most markets, and “we think it was denied because…” is not a defensible position in an examination.',
        'Aster is built so the answer is always available and always exact: pull the exact rule version and inputs from the moment of the decision, and recompute the identical result. Not a log entry — the real path. We call this replay.',
        'But replay only means something if you can trust the engine that recomputes is correct. That is what this paper is about.',
      ],
    },
    meaning: {
      heading: '2. What “dual-engine equivalence” means (in one paragraph)',
      paras: [
        'Aster ships two completely independent execution engines built by different toolchains: a Java engine (compiled, runs on the GraalVM/Truffle runtime), used in the backend; and a TypeScript engine (runs in the browser and in Node), used for previews and offline checks.',
        'They were implemented separately — different parsing technology, different code, different authors. For every rule and every input, both engines must produce the byte-for-byte identical result. If they ever disagreed, that disagreement would be a loud, automated failure — and a release would be blocked.',
        'Why this matters to you: a single engine can be subtly wrong and nobody would know — the wrong answer looks just as confident as the right one. Two independent engines that always agree is a continuous, automated cross-check. It turns “trust our implementation” into “two independent implementations confirm each other, on every change.”',
        'This is the same principle as dual-control in finance: you don’t trust one signer; you require two independent ones to agree.',
      ],
    },
    evidence: {
      heading: '3. The evidence (measured, not asserted)',
      intro: 'These numbers are produced by an automated test suite on every change and published openly. You can see the live figures and trend at aster-lang.cloud/equivalence, and the raw data and test harness in the public aster-lang-test repository.',
      colLayer: 'Layer of agreement',
      colResult: 'Result',
      colProves: 'What it proves',
      rows: [
        { layer: 'Acceptance (parse)', result: '208 / 208 identical', proves: 'Both engines read the same rule the same way — zero ambiguity in what the rule says.' },
        { layer: 'Execution (eval)', result: '239 / 239 byte-for-byte identical', proves: 'Both engines compute the same decision for the same inputs — zero disagreement in what the rule does. This is the strong one.' },
        { layer: 'Internal form (IR)', result: '203 / 203 structurally identical', proves: 'Both engines reduce the rule to the same internal logic before running it.' },
        { layer: 'Execution coverage', result: '132 / 132 (100%)', proves: 'Every runnable rule in the test corpus is actually executed and checked on both engines — not just parsed.' },
        { layer: 'Feature coverage', result: '49 / 49 (100%)', proves: 'Every non-experimental language feature is exercised by the equivalence suite.' },
      ],
      zeroDivergence: 'Zero divergences at the execution layer. Every change that would introduce one is caught before it can ship — the parse-level check is a hard, release-blocking gate in three separate repositories.',
      honestyNote: 'A note on honesty: we publish a divergence ledger (DIVERGENT-MANIFEST.md, IR-DIVERGENCE-LEDGER.md) that records every case where the engines ever differed, the root cause, and the fix. We also mark which checks are release-blocking versus report-only. The internal-form (IR) comparison has a small number of representation-level items that are tracked openly and do not affect the decision output. We would rather you see the full picture than a polished one — auditors trust ledgers, not adjectives.',
    },
    example: {
      heading: '4. Worked example: a declined loan',
      intro: 'Consider this credit-approval rule (Aster’s controlled English — readable by your team, not just engineers):',
      ruleCode: RULE_EN,
      declinedLead: 'An applicant with credit score 561 is declined. Six months later, the regulator asks why. With Aster, you replay decision APP-10561:',
      steps: [
        'dtiRatio = 1640 ÷ 4100 = 0.40',
        'creditScore ≥ 740 and dtiRatio ≤ 0.35 → 561 ≥ 740 ✗ → false',
        'creditScore ≥ 660 and dtiRatio ≤ 0.43 → 561 ≥ 660 ✗ → false',
        'creditScore ≥ 600 → 561 ≥ 600 ✗ → false',
        'Return “Declined — credit score below threshold”',
      ],
      closing: 'This is recomputed from the exact rule version and inputs in force at decision time, and the result is verified identical across both engines. You are not showing the auditor a guess or a log line — you are showing them the decision being made again, deterministically, in front of them.',
      tryAt: 'You can run this exact scenario at aster-lang.cloud/demo.',
    },
    buys: {
      heading: '5. What this buys you',
      items: [
        { title: 'Adverse-action defensibility.', body: 'Any decision — approve, refer, decline — can be replayed step-by-step from the governing rule version. The explanation is the computation, not a narrative reconstruction.' },
        { title: 'Change governance.', body: 'Rules are versioned and approval-gated. The version that ran in production is verifiable as the version that was approved — not a hand-edited drift.' },
        { title: 'Independent assurance, continuously.', body: 'Two engines agreeing on every change is an always-on control, not a point-in-time audit. It does not degrade between reviews.' },
        { title: 'Readable by the people accountable.', body: 'Rules are written in controlled English (also 中文, Deutsch), so risk and compliance can read and sign off on the actual logic — not a translation an engineer assures them is faithful.' },
      ],
    },
    scope: {
      heading: '6. Scope, limits, and honesty',
      items: [
        { title: 'What equivalence proves:', body: 'that the two engines agree on accepting, internally representing, and executing the language’s stable feature set. It does not claim the rules you write are correct — that is your policy’s job; Aster guarantees the engine executes them faithfully and reproducibly.' },
        { title: 'Stable vs. experimental.', body: 'Aster v1.0.0 freezes a Stable language subset (declarations, statements, all operators, the standard library, type aliases) under a 1.x compatibility commitment. Asynchronous workflows, the effect system, and cross-module references are marked Experimental and are out of scope for the equivalence guarantee until frozen.' },
        { title: 'Coverage is honest, not inflated.', body: 'The 100% figures are against a defined corpus with explicit, documented exemptions (e.g. asynchronous and effect-bearing features that have no deterministic golden output). The exemptions are listed, not hidden.' },
        { title: 'The data is yours to re-run.', body: 'Everything here is reproducible from the public aster-lang-test repository. We invite your team — or your auditor — to run it.' },
      ],
    },
    oneSentence: {
      heading: '7. One sentence',
      body: 'Aster runs your credit rules on two independently built engines that must agree on every decision, byte for byte, on every change — so when someone asks how a decision was made, you replay it and prove it, instead of reconstructing it and hoping.',
    },
    footer: 'Figures in this document reflect Aster Lang v1.0.0 as measured on 2026-06-10. Live figures: aster-lang.cloud/equivalence. Test harness and divergence ledgers: github.com/aster-cloud/aster-lang-test. This paper is a plain-language summary for risk and compliance stakeholders; a technical companion (engine architecture, IR normalization, golden-case methodology) is available for architecture review.',
  },

  zh: {
    meta: {
      title: '两套引擎，同一答案',
      subtitle: 'Aster 如何证明一笔信贷决策可复现 — 面向风控与合规的白皮书',
      audienceLabel: '读者',
      audience: '信贷风控、模型治理与合规负责人。',
      versionLabel: '版本',
      version: '1.0 · 2026-06-12 · Aster Lang v1.0.0',
      whatLabel: '这是什么',
      what: '一份用平实语言解释「为何可以信任 Aster 产出的决策」的文档，以公开、可重跑的测量为支撑——不是营销说辞。',
      downloadPdf: '下载 PDF',
      printHint: '将打开浏览器打印对话框——请选择「另存为 PDF」。',
      backToEquivalence: '返回实时等价数据',
    },
    problem: {
      heading: '1. 你真正面对的问题',
      paras: [
        '当监管、审计或一位被拒的客户问起「这笔决策是怎么做出来的？」，多数信贷系统给不出干净的答案。规则可能变了，数据可能变了，代码路径可能变了。工程师最后只能去「重建」大概发生了什么——这与「证明」实际发生了什么并不是一回事。',
        '对信贷决策而言，这道鸿沟绝非纸上谈兵。不利决策可解释性在多数市场是法定义务，而「我们觉得当时被拒大概是因为……」在检查中站不住脚。',
        'Aster 的构建方式让答案永远可得、永远精确：取出决策发生那一刻的确切规则版本与输入，重新算出完全相同的结果。不是一条日志——是真正的路径。我们称之为「回放」。',
        '但回放只有在你能信任「重算的引擎是正确的」时才有意义。这正是本白皮书要谈的。',
      ],
    },
    meaning: {
      heading: '2. 「双引擎等价」是什么意思（一段话讲清）',
      paras: [
        'Aster 交付两套完全独立、由不同工具链构建的执行引擎：一套 Java 引擎（编译型，运行在 GraalVM/Truffle 运行时），用于后端；一套 TypeScript 引擎（运行在浏览器与 Node 中），用于预览与离线校验。',
        '它们是分别实现的——不同的解析技术、不同的代码、不同的作者。对每一条规则、每一组输入，两套引擎必须产出逐字节完全相同的结果。一旦它们出现分歧，那个分歧就会变成一次响亮的、自动化的失败——并阻断发布。',
        '这对你为何重要：单一引擎可能在不易察觉处出错而无人知晓——错误答案看起来和正确答案一样自信。两套始终一致的独立引擎，就是一道持续、自动的交叉校验。它把「请信任我们的实现」变成「两个独立实现在每一次改动上互相印证」。',
        '这与金融里的「双人复核」原理相同：你不信任单一签字人；你要求两个独立签字人达成一致。',
      ],
    },
    evidence: {
      heading: '3. 证据（测量得来，而非断言）',
      intro: '这些数字由自动化测试套件在每次改动时产出并公开发布。你可以在 aster-lang.cloud/equivalence 看到实时数值与趋势，在公开的 aster-lang-test 仓库看到原始数据与测试夹具。',
      colLayer: '一致性层级',
      colResult: '结果',
      colProves: '它证明了什么',
      rows: [
        { layer: '接受（解析）', result: '208 / 208 一致', proves: '两套引擎以相同方式读同一条规则——对规则「说了什么」零歧义。' },
        { layer: '执行（求值）', result: '239 / 239 逐字节一致', proves: '两套引擎对相同输入算出相同决策——对规则「做了什么」零分歧。这是最强的一项。' },
        { layer: '内部形态（IR）', result: '203 / 203 结构一致', proves: '两套引擎在运行前把规则归约为相同的内部逻辑。' },
        { layer: '执行覆盖率', result: '132 / 132（100%）', proves: '测试语料中每一条可运行规则都真正在两套引擎上执行并核对——不只是被解析。' },
        { layer: '特性覆盖率', result: '49 / 49（100%）', proves: '每一项非实验性语言特性都被等价套件覆盖到。' },
      ],
      zeroDivergence: '执行层零分歧。任何会引入分歧的改动都在发布前被拦截——解析层校验是三个独立仓库里的硬性、阻断发布的关卡。',
      honestyNote: '关于诚实的一点说明：我们公开一份分歧台账（DIVERGENT-MANIFEST.md、IR-DIVERGENCE-LEDGER.md），记录引擎曾经出现的每一处分歧、其根因与修复方式。我们也标明哪些校验是阻断发布的、哪些是仅报告的。内部形态（IR）比对有少量「表示层级」条目，被公开追踪，且不影响决策输出。我们宁愿让你看到完整图景，而非粉饰过的版本——审计员信任台账，而非形容词。',
    },
    example: {
      heading: '4. 实例演练：一笔被拒的贷款',
      intro: '看这条信贷准入规则（Aster 的受控中文——你的团队读得懂，不只是工程师）：',
      ruleCode: RULE_ZH,
      declinedLead: '一位信用分 561 的申请人被拒。六个月后，监管问为什么。用 Aster，你回放决策 APP-10561：',
      steps: [
        '负债比 = 1640 ÷ 4100 = 0.40',
        '信用分 ≥ 740 且 负债比 ≤ 0.35 → 561 ≥ 740 ✗ → 假',
        '信用分 ≥ 660 且 负债比 ≤ 0.43 → 561 ≥ 660 ✗ → 假',
        '信用分 ≥ 600 → 561 ≥ 600 ✗ → 假',
        '返回「拒绝 — 信用分低于门槛」',
      ],
      closing: '这是从决策当时生效的确切规则版本与输入重新算出的，且结果经两套引擎核对一致。你给审计员看的不是猜测、不是一行日志——而是这笔决策在他们面前被确定性地再做一遍。',
      tryAt: '你可以在 aster-lang.cloud/demo 跑这个完全一样的场景。',
    },
    buys: {
      heading: '5. 它给你带来什么',
      items: [
        { title: '不利决策可辩护。', body: '任何决策——批准、转人工、拒绝——都能从治理它的规则版本逐步回放。解释就是计算本身，而非事后叙事重建。' },
        { title: '变更治理。', body: '规则有版本、有审批关卡。在生产中运行的版本，可被验证就是被批准的版本——不是手改后的漂移。' },
        { title: '持续的独立保证。', body: '两套引擎在每次改动上达成一致，是一道常开的控制，而非某个时点的审计。它不会在两次评审之间退化。' },
        { title: '由问责者本人可读。', body: '规则用受控自然语言写成（也支持 English、Deutsch），因而风控与合规能读懂并签署真正的逻辑——而非工程师向他们保证「忠实」的一份转译。' },
      ],
    },
    scope: {
      heading: '6. 范围、边界与诚实',
      items: [
        { title: '等价证明了什么：', body: '两套引擎在「接受、内部表示、执行」语言的稳定特性集上达成一致。它并不声称你所写的规则是正确的——那是你的策略的职责；Aster 保证的是引擎忠实且可复现地执行它们。' },
        { title: '稳定 vs. 实验。', body: 'Aster v1.0.0 冻结了一个稳定语言子集（声明、语句、全部运算符、标准库、类型别名），并附带 1.x 兼容性承诺。异步工作流、效应系统与跨模块引用被标为实验性，在冻结前不在等价保证范围内。' },
        { title: '覆盖率诚实，未注水。', body: '这些 100% 的数字是针对一个明确定义的语料、附带明示且有文档记录的豁免项（例如没有确定性黄金输出的异步与带效应特性）。豁免项是列出来的，不是藏起来的。' },
        { title: '数据由你重跑。', body: '本文一切内容都可从公开的 aster-lang-test 仓库复现。我们邀请你的团队——或你的审计员——亲自运行。' },
      ],
    },
    oneSentence: {
      heading: '7. 一句话',
      body: 'Aster 让你的信贷规则跑在两套独立构建的引擎上，它们必须在每一次改动、每一笔决策上逐字节一致——于是当有人问起一笔决策是怎么做的，你回放它、证明它，而不是重建它再祈祷没错。',
    },
    footer: '本文数字反映 Aster Lang v1.0.0 在 2026-06-10 的测量。实时数值：aster-lang.cloud/equivalence。测试夹具与分歧台账：github.com/aster-cloud/aster-lang-test。本文是面向风控与合规相关方的平实语言摘要；技术配套文档（引擎架构、IR 归一化、黄金用例方法论）可供架构评审取用。',
  },

  de: {
    meta: {
      title: 'Zwei Engines, eine Antwort',
      subtitle: 'Wie Aster beweist, dass eine Kreditentscheidung reproduzierbar ist — ein Whitepaper für Risk & Compliance',
      audienceLabel: 'Zielgruppe',
      audience: 'Leitung von Kreditrisiko, Modell-Governance und Compliance.',
      versionLabel: 'Version',
      version: '1.0 · 2026-06-12 · Aster Lang v1.0.0',
      whatLabel: 'Worum es geht',
      what: 'Eine Erklärung in Klartext, warum Sie den von Aster erzeugten Entscheidungen vertrauen können — gestützt auf veröffentlichte, wiederholbare Messungen, nicht auf Marketingaussagen.',
      downloadPdf: 'PDF herunterladen',
      printHint: 'Öffnet den Druckdialog Ihres Browsers — wählen Sie „Als PDF speichern“.',
      backToEquivalence: 'Zurück zu den Live-Äquivalenzzahlen',
    },
    problem: {
      heading: '1. Das Problem, das Sie tatsächlich haben',
      paras: [
        'Wenn eine Aufsichtsbehörde, ein Prüfer oder ein abgelehnter Kunde fragt „Wie kam diese Entscheidung zustande?“, kann die Mehrheit der Kreditsysteme keine saubere Antwort geben. Die Regel könnte sich geändert haben. Die Daten könnten sich geändert haben. Der Codepfad könnte sich geändert haben. Entwickler rekonstruieren am Ende, was wahrscheinlich passiert ist — was nicht dasselbe ist wie zu beweisen, was tatsächlich passiert ist.',
        'Für Kreditentscheidungen ist diese Lücke nicht akademisch. Die Erklärbarkeit nachteiliger Entscheidungen ist in den meisten Märkten eine gesetzliche Pflicht, und „Wir glauben, es wurde abgelehnt, weil …“ ist in einer Prüfung keine haltbare Position.',
        'Aster ist so gebaut, dass die Antwort immer verfügbar und immer exakt ist: die genaue Regelversion und die Eingaben aus dem Moment der Entscheidung abrufen und das identische Ergebnis neu berechnen. Kein Log-Eintrag — der echte Pfad. Wir nennen das Replay.',
        'Aber Replay bedeutet nur etwas, wenn Sie darauf vertrauen können, dass die neu berechnende Engine korrekt ist. Genau darum geht es in diesem Papier.',
      ],
    },
    meaning: {
      heading: '2. Was „Dual-Engine-Äquivalenz“ bedeutet (in einem Absatz)',
      paras: [
        'Aster liefert zwei vollständig unabhängige Ausführungs-Engines aus, gebaut mit unterschiedlichen Toolchains: eine Java-Engine (kompiliert, läuft auf der GraalVM/Truffle-Laufzeit), im Backend eingesetzt; und eine TypeScript-Engine (läuft im Browser und in Node), für Vorschauen und Offline-Prüfungen.',
        'Sie wurden getrennt implementiert — unterschiedliche Parsing-Technologie, unterschiedlicher Code, unterschiedliche Autoren. Für jede Regel und jede Eingabe müssen beide Engines das Byte-für-Byte identische Ergebnis erzeugen. Sollten sie je voneinander abweichen, wäre diese Abweichung ein lauter, automatisierter Fehlschlag — und ein Release würde blockiert.',
        'Warum das für Sie zählt: Eine einzelne Engine kann auf subtile Weise falsch sein, ohne dass es jemand merkt — die falsche Antwort wirkt genauso souverän wie die richtige. Zwei unabhängige Engines, die stets übereinstimmen, sind ein kontinuierlicher, automatisierter Gegencheck. Das macht aus „Vertrauen Sie unserer Implementierung“ ein „Zwei unabhängige Implementierungen bestätigen einander, bei jeder Änderung“.',
        'Das ist dasselbe Prinzip wie das Vier-Augen-Prinzip im Finanzwesen: Sie vertrauen nicht einem Unterzeichner; Sie verlangen, dass zwei unabhängige übereinstimmen.',
      ],
    },
    evidence: {
      heading: '3. Die Belege (gemessen, nicht behauptet)',
      intro: 'Diese Zahlen werden von einer automatisierten Testsuite bei jeder Änderung erzeugt und offen veröffentlicht. Die Live-Werte und den Trend sehen Sie auf aster-lang.cloud/equivalence, die Rohdaten und das Test-Harness im öffentlichen Repository aster-lang-test.',
      colLayer: 'Ebene der Übereinstimmung',
      colResult: 'Ergebnis',
      colProves: 'Was es beweist',
      rows: [
        { layer: 'Annahme (Parsing)', result: '208 / 208 identisch', proves: 'Beide Engines lesen dieselbe Regel auf dieselbe Weise — null Mehrdeutigkeit darüber, was die Regel sagt.' },
        { layer: 'Ausführung (Auswertung)', result: '239 / 239 Byte-für-Byte identisch', proves: 'Beide Engines berechnen für dieselben Eingaben dieselbe Entscheidung — null Uneinigkeit darüber, was die Regel tut. Das ist der starke Punkt.' },
        { layer: 'Interne Form (IR)', result: '203 / 203 strukturell identisch', proves: 'Beide Engines reduzieren die Regel vor der Ausführung auf dieselbe interne Logik.' },
        { layer: 'Ausführungsabdeckung', result: '132 / 132 (100%)', proves: 'Jede ausführbare Regel im Test-Korpus wird auf beiden Engines tatsächlich ausgeführt und geprüft — nicht nur geparst.' },
        { layer: 'Feature-Abdeckung', result: '49 / 49 (100%)', proves: 'Jedes nicht-experimentelle Sprachfeature wird von der Äquivalenz-Suite ausgeübt.' },
      ],
      zeroDivergence: 'Null Abweichungen auf der Ausführungsebene. Jede Änderung, die eine einführen würde, wird vor dem Ausliefern abgefangen — die Prüfung auf Parsing-Ebene ist ein harter, Release-blockierender Gate in drei separaten Repositories.',
      honestyNote: 'Eine Anmerkung zur Ehrlichkeit: Wir veröffentlichen ein Abweichungs-Register (DIVERGENT-MANIFEST.md, IR-DIVERGENCE-LEDGER.md), das jeden Fall festhält, in dem die Engines je voneinander abwichen, die Grundursache und die Behebung. Wir kennzeichnen auch, welche Prüfungen Release-blockierend und welche nur berichtend sind. Der Vergleich der internen Form (IR) enthält eine kleine Anzahl darstellungsbezogener Punkte, die offen verfolgt werden und die Entscheidungsausgabe nicht beeinflussen. Wir zeigen Ihnen lieber das vollständige Bild als ein geschöntes — Prüfer vertrauen Registern, nicht Adjektiven.',
    },
    example: {
      heading: '4. Durchgerechnetes Beispiel: ein abgelehnter Kredit',
      intro: 'Betrachten Sie diese Kreditzusage-Regel (Asters kontrolliertes Deutsch — lesbar für Ihr Team, nicht nur für Entwickler):',
      ruleCode: RULE_DE,
      declinedLead: 'Ein Antragsteller mit Score 561 wird abgelehnt. Sechs Monate später fragt die Aufsicht nach dem Grund. Mit Aster spielen Sie die Entscheidung APP-10561 ab:',
      steps: [
        'quote = 1640 ÷ 4100 = 0,40',
        'score ≥ 740 und quote ≤ 0,35 → 561 ≥ 740 ✗ → falsch',
        'score ≥ 660 und quote ≤ 0,43 → 561 ≥ 660 ✗ → falsch',
        'score ≥ 600 → 561 ≥ 600 ✗ → falsch',
        'gib zurück „Abgelehnt — Bonität unter Schwellenwert“',
      ],
      closing: 'Dies wird aus der exakten Regelversion und den zum Entscheidungszeitpunkt geltenden Eingaben neu berechnet, und das Ergebnis ist über beide Engines hinweg als identisch verifiziert. Sie zeigen dem Prüfer keine Vermutung und keine Log-Zeile — Sie zeigen ihm, wie die Entscheidung vor seinen Augen deterministisch erneut getroffen wird.',
      tryAt: 'Genau dieses Szenario können Sie auf aster-lang.cloud/demo ausführen.',
    },
    buys: {
      heading: '5. Was Ihnen das bringt',
      items: [
        { title: 'Verteidigbarkeit nachteiliger Entscheidungen.', body: 'Jede Entscheidung — Zusage, manuelle Prüfung, Ablehnung — lässt sich Schritt für Schritt aus der maßgeblichen Regelversion abspielen. Die Erklärung ist die Berechnung, keine nachträgliche Erzählung.' },
        { title: 'Änderungs-Governance.', body: 'Regeln sind versioniert und freigabepflichtig. Die in der Produktion gelaufene Version ist als die freigegebene Version verifizierbar — keine handgeänderte Abweichung.' },
        { title: 'Unabhängige Absicherung, kontinuierlich.', body: 'Zwei Engines, die bei jeder Änderung übereinstimmen, sind eine stets aktive Kontrolle, keine punktuelle Prüfung. Sie verfällt nicht zwischen zwei Reviews.' },
        { title: 'Lesbar für die Verantwortlichen.', body: 'Regeln sind in kontrolliertem Deutsch geschrieben (auch English, 中文), sodass Risk und Compliance die tatsächliche Logik lesen und abzeichnen können — nicht eine Übersetzung, die ein Entwickler als getreu versichert.' },
      ],
    },
    scope: {
      heading: '6. Umfang, Grenzen und Ehrlichkeit',
      items: [
        { title: 'Was Äquivalenz beweist:', body: 'dass die beiden Engines beim Annehmen, internen Darstellen und Ausführen des stabilen Feature-Sets der Sprache übereinstimmen. Sie behauptet nicht, dass die von Ihnen geschriebenen Regeln korrekt sind — das ist Aufgabe Ihrer Richtlinie; Aster garantiert, dass die Engine sie getreu und reproduzierbar ausführt.' },
        { title: 'Stabil vs. experimentell.', body: 'Aster v1.0.0 friert eine stabile Sprach-Teilmenge ein (Deklarationen, Anweisungen, alle Operatoren, die Standardbibliothek, Typ-Aliase) unter einer 1.x-Kompatibilitätszusage. Asynchrone Workflows, das Effektsystem und modulübergreifende Referenzen sind als experimentell markiert und bis zum Einfrieren nicht von der Äquivalenzgarantie abgedeckt.' },
        { title: 'Die Abdeckung ist ehrlich, nicht aufgebläht.', body: 'Die 100-%-Werte beziehen sich auf ein definiertes Korpus mit ausdrücklichen, dokumentierten Ausnahmen (z. B. asynchrone und effektbehaftete Features ohne deterministische Golden-Ausgabe). Die Ausnahmen sind aufgeführt, nicht verborgen.' },
        { title: 'Die Daten gehören Ihnen zum Nachrechnen.', body: 'Alles hier ist aus dem öffentlichen Repository aster-lang-test reproduzierbar. Wir laden Ihr Team — oder Ihren Prüfer — ein, es auszuführen.' },
      ],
    },
    oneSentence: {
      heading: '7. In einem Satz',
      body: 'Aster führt Ihre Kreditregeln auf zwei unabhängig gebauten Engines aus, die bei jeder Entscheidung, Byte für Byte, bei jeder Änderung übereinstimmen müssen — sodass Sie, wenn jemand fragt, wie eine Entscheidung zustande kam, sie abspielen und beweisen, statt sie zu rekonstruieren und zu hoffen.',
    },
    footer: 'Die Zahlen in diesem Dokument spiegeln Aster Lang v1.0.0 wider, gemessen am 2026-06-10. Live-Werte: aster-lang.cloud/equivalence. Test-Harness und Abweichungs-Register: github.com/aster-cloud/aster-lang-test. Dieses Papier ist eine Klartext-Zusammenfassung für Risk- und Compliance-Stakeholder; ein technischer Begleittext (Engine-Architektur, IR-Normalisierung, Golden-Case-Methodik) steht für das Architektur-Review zur Verfügung.',
  },
};

/** 取当前语言的白皮书内容。 */
export function getWhitepaper(locale: string): WhitepaperContent {
  return WHITEPAPER[toWhitepaperLocale(locale)];
}
