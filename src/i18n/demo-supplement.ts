/**
 * @module i18n/demo-supplement
 *
 * cloud 特有 UI 的**本地补充文案**，经 `deepMergeMessages` 叠加在 `@aster-cloud/ui-messages`
 * npm 包加载的 messages 之上（见 request.ts）。
 *
 * 为什么不放共享 npm 包：这些是 **cloud 前端特有的 UI 文本**（信贷 demo + 团队语言卡的
 * toggle 文案），不是与后端 aster-api 共享的语言包内容。放进共享包会胖化它、引入跨仓发版
 * 耦合。本地补充层让新增/微调 cloud UI 文案无需 npm republish。
 *
 * 当前补充：
 * - `demoPage.*`（boundary 翻转对照 + dualEngine 双引擎对比）
 * - `languageSettings.toggleAriaLabel` / `languageSettings.saveFailed`（团队语言卡改为
 *   每行 Toggle 即点即生效后新增，与 platformLanguageSettings 同结构）
 *
 * deepMergeMessages 深合并：只新增上述 key，不覆盖包里已有的 demoPage/languageSettings
 * 其余文案。缺 locale 的 key 由 request.ts 的 en 底座兜底。
 */

import type { Locale } from './config';

type MessageTree = Record<string, unknown>;

/**
 * 各 locale 的 demoPage 补充文案。en 为底座（必全），zh/de/hi 补齐；缺的 key
 * 由 deepMergeMessages 落到 en。
 */
export const DEMO_SUPPLEMENT: Record<Locale, MessageTree> = {
  en: {
    docs: {
      overlay: {
        openFull: 'Open full docs',
        close: 'Close docs',
        contents: 'Contents',
        loadError: 'Could not load this page.',
        searchPlaceholder: 'Search docs…',
        noResults: 'No results',
      },
    },
    demosIndex: {
      seo: {
        title: 'Demos — Aster Lang',
        description: 'Interactive demos: replay a credit decision, write rules in industry vocabulary, and a playful cat-mood engine.',
      },
      eyebrow: 'Demos',
      title: 'See Aster in action',
      subtitle: 'Three live demos — each runs the real engine in your browser, no signup.',
      enter: 'Open demo',
      cards: {
        credit: {
          title: 'Replay a credit decision',
          description: 'A real loan-approval rule decides an application — then replay exactly how, the answer you give a regulator. With a byte-for-byte two-engine check and a tamper-checkable decision hash.',
        },
        vocab: {
          title: 'Domain vocabulary',
          description: 'Write the same rule in the words your industry actually uses — across three domains — and watch it compile and run unchanged.',
        },
        kitten: {
          title: 'Cat mood engine 🐱',
          description: 'A playful one: a poetic cat-vocabulary rule drives a little hand-drawn cat animation. Proof that Aster rules read like plain language.',
        },
      },
    },
    footer: {
      demos: 'Demos',
    },
    languageSettings: {
      toggleAriaLabel: 'Toggle {language} for this team',
      saveFailed: 'Could not update — please try again',
    },
    demoPage: {
      scenarios: {
        boundaryPass: { label: 'Boundary — score 660' },
        boundaryFail: { label: 'Boundary — score 659' },
      },
      boundary: {
        title: 'One point, opposite decision',
        hint: 'Two applications, identical in every field except a single credit-score point. Watch the decision flip — and replay exactly why.',
        passLabel: 'Score 660',
        failLabel: 'Score 659',
        flipNote: 'Same rule, same inputs — a 1-point difference at the {threshold} cut-off flips {pass} into {fail}. The replay below shows the precise step that changed.',
        noFlipNote: 'At the current thresholds these two no longer differ — both return {pass}. Set the standard score cut-off back to 660 to see the 1-point boundary flip.',
        identicalExcept: 'Identical except credit score',
      },
      dualEngine: {
        title: 'Two engines, one answer',
        hint: 'The same rule runs on two independently-built engines — TypeScript in your browser and the JVM (Truffle) on the server. They agree byte-for-byte. That is the trust guarantee: the decision is the rule, not one implementation of it.',
        tsLabel: 'TypeScript engine (browser)',
        jvmLabel: 'JVM engine (server)',
        agree: 'Byte-for-byte identical',
        disagree: 'Engines disagree — this should never happen',
        jvmUnavailable: 'Server engine unavailable — showing browser engine only',
        checking: 'Running on the server engine…',
      },
      hash: {
        heading: 'Decision hash',
        sub: 'A SHA-256 of the exact rule, inputs, decision, and reasoning. Recompute it anywhere — same record, same hash. The decision is deterministically reproducible and independently checkable; any change to the rule, inputs, or outcome produces a different hash.',
        computing: 'Computing hash…',
        unavailable: 'Hash unavailable in this browser',
        copy: 'Copy',
        copied: 'Copied',
      },
    },
  },
  zh: {
    docs: {
      overlay: {
        openFull: '打开完整文档',
        close: '关闭文档',
        contents: '目录',
        loadError: '无法加载此页面。',
        searchPlaceholder: '搜索文档…',
        noResults: '无结果',
      },
    },
    demosIndex: {
      seo: {
        title: 'Demo 演示 — Aster Lang',
        description: '交互式演示：回放一笔信贷决策、用行业词汇编写规则、以及一个有趣的猫咪心情引擎。',
      },
      eyebrow: 'Demo 演示',
      title: '看 Aster 跑起来',
      subtitle: '三个在线演示——每个都在你浏览器里跑真引擎，无需注册。',
      enter: '打开演示',
      cards: {
        credit: {
          title: '回放一笔信贷决策',
          description: '一条真实的贷款准入规则对申请作出决策——然后逐步回放它是怎么得出的，正是你交给监管的答案。含双引擎逐字节核对与可核验的决策哈希。',
        },
        vocab: {
          title: '领域词汇',
          description: '用你所在行业真正在用的词写同一条规则——跨三个领域——看它原样编译并执行。',
        },
        kitten: {
          title: '猫咪心情引擎 🐱',
          description: '一个有趣的演示：一条富有诗意的猫咪词汇规则驱动一只手绘小猫动画。证明 Aster 规则读起来就像平常说话。',
        },
      },
    },
    footer: {
      demos: 'Demo 演示',
    },
    languageSettings: {
      toggleAriaLabel: '为本团队开关{language}',
      saveFailed: '更新失败——请重试',
    },
    demoPage: {
      scenarios: {
        boundaryPass: { label: '边界 — 信用分 660' },
        boundaryFail: { label: '边界 — 信用分 659' },
      },
      boundary: {
        title: '一分之差，决策相反',
        hint: '两份申请，除一个信用分点外字段完全相同。看决策如何翻转——并逐步回放为什么。',
        passLabel: '信用分 660',
        failLabel: '信用分 659',
        flipNote: '同一条规则、同样的输入——在 {threshold} 门槛上 1 分之差，把 {pass} 翻转成 {fail}。下方回放精确展示改变结果的那一步。',
        noFlipNote: '当前阈值下这两份申请不再有差异——都返回 {pass}。把标准分门槛调回 660 即可看到 1 分边界翻转。',
        identicalExcept: '除信用分外完全相同',
      },
      dualEngine: {
        title: '两个引擎，同一个答案',
        hint: '同一条规则在两个独立构建的引擎上运行——浏览器里的 TypeScript 与服务器上的 JVM（Truffle）。它们逐字节一致。这就是信任保证：决策来自规则本身，而非某一个实现。',
        tsLabel: 'TypeScript 引擎（浏览器）',
        jvmLabel: 'JVM 引擎（服务器）',
        agree: '逐字节完全相同',
        disagree: '两引擎不一致——这绝不应发生',
        jvmUnavailable: '服务器引擎不可用——仅显示浏览器引擎',
        checking: '正在服务器引擎上执行…',
      },
      hash: {
        heading: '决策哈希',
        sub: '这是规则、输入、决策与推理的 SHA-256 摘要。在任何地方重算都一致——同一记录、同一哈希。决策可确定性重算、可独立核验；规则、输入或结果任何改动都会产出不同的哈希。',
        computing: '正在计算哈希…',
        unavailable: '当前浏览器无法计算哈希',
        copy: '复制',
        copied: '已复制',
      },
    },
  },
  de: {
    docs: {
      overlay: {
        openFull: 'Vollständige Doku öffnen',
        close: 'Doku schließen',
        contents: 'Inhalt',
        loadError: 'Diese Seite konnte nicht geladen werden.',
        searchPlaceholder: 'Doku durchsuchen…',
        noResults: 'Keine Treffer',
      },
    },
    demosIndex: {
      seo: {
        title: 'Demos — Aster Lang',
        description: 'Interaktive Demos: eine Kreditentscheidung wiedergeben, Regeln in Branchenvokabular schreiben und eine verspielte Katzenstimmungs-Engine.',
      },
      eyebrow: 'Demos',
      title: 'Aster in Aktion erleben',
      subtitle: 'Drei Live-Demos — jede führt die echte Engine in Ihrem Browser aus, ohne Anmeldung.',
      enter: 'Demo öffnen',
      cards: {
        credit: {
          title: 'Eine Kreditentscheidung wiedergeben',
          description: 'Eine echte Kreditvergaberegel entscheidet über einen Antrag — und Sie spielen genau nach, wie, die Antwort für eine Prüfbehörde. Mit Byte-für-Byte-Zwei-Engine-Abgleich und prüfbarem Entscheidungs-Hash.',
        },
        vocab: {
          title: 'Fachvokabular',
          description: 'Schreiben Sie dieselbe Regel in den Worten, die Ihre Branche tatsächlich verwendet — über drei Domänen hinweg — und sehen Sie, wie sie unverändert kompiliert und läuft.',
        },
        kitten: {
          title: 'Katzenstimmungs-Engine 🐱',
          description: 'Eine verspielte: Eine poetische Katzen-Vokabular-Regel steuert eine kleine handgezeichnete Katzen-Animation. Beweis, dass Aster-Regeln wie normale Sprache lesbar sind.',
        },
      },
    },
    footer: {
      demos: 'Demos',
    },
    languageSettings: {
      toggleAriaLabel: '{language} für dieses Team umschalten',
      saveFailed: 'Aktualisierung fehlgeschlagen — bitte erneut versuchen',
    },
    demoPage: {
      scenarios: {
        boundaryPass: { label: 'Grenzfall — Score 660' },
        boundaryFail: { label: 'Grenzfall — Score 659' },
      },
      boundary: {
        title: 'Ein Punkt, entgegengesetzte Entscheidung',
        hint: 'Zwei Anträge, in jedem Feld identisch bis auf einen einzigen Bonitätspunkt. Sehen Sie, wie die Entscheidung kippt — und spielen Sie genau nach, warum.',
        passLabel: 'Score 660',
        failLabel: 'Score 659',
        flipNote: 'Dieselbe Regel, dieselben Eingaben — ein Unterschied von 1 Punkt an der {threshold}-Schwelle macht aus {pass} ein {fail}. Die Wiedergabe unten zeigt den genauen Schritt, der sich geändert hat.',
        noFlipNote: 'Bei den aktuellen Schwellenwerten unterscheiden sich diese beiden nicht mehr — beide ergeben {pass}. Setzen Sie die Standard-Score-Schwelle auf 660 zurück, um den 1-Punkt-Grenzfall zu sehen.',
        identicalExcept: 'Identisch bis auf die Bonität',
      },
      dualEngine: {
        title: 'Zwei Engines, eine Antwort',
        hint: 'Dieselbe Regel läuft auf zwei unabhängig gebauten Engines — TypeScript im Browser und die JVM (Truffle) auf dem Server. Sie stimmen Byte für Byte überein. Das ist die Vertrauensgarantie: Die Entscheidung ist die Regel, nicht eine ihrer Implementierungen.',
        tsLabel: 'TypeScript-Engine (Browser)',
        jvmLabel: 'JVM-Engine (Server)',
        agree: 'Byte für Byte identisch',
        disagree: 'Engines stimmen nicht überein — das sollte nie passieren',
        jvmUnavailable: 'Server-Engine nicht verfügbar — nur Browser-Engine',
        checking: 'Läuft auf der Server-Engine…',
      },
      hash: {
        heading: 'Entscheidungs-Hash',
        sub: 'Ein SHA-256 der exakten Regel, Eingaben, Entscheidung und Begründung. Überall neu berechnet — gleicher Datensatz, gleicher Hash. Die Entscheidung ist deterministisch reproduzierbar und unabhängig überprüfbar; jede Änderung an Regel, Eingaben oder Ergebnis erzeugt einen anderen Hash.',
        computing: 'Hash wird berechnet…',
        unavailable: 'Hash in diesem Browser nicht verfügbar',
        copy: 'Kopieren',
        copied: 'Kopiert',
      },
    },
  },
  hi: {
    docs: {
      overlay: {
        openFull: 'पूरा दस्तावेज़ खोलें',
        close: 'दस्तावेज़ बंद करें',
        contents: 'विषय-सूची',
        loadError: 'यह पृष्ठ लोड नहीं हो सका।',
        searchPlaceholder: 'दस्तावेज़ खोजें…',
        noResults: 'कोई परिणाम नहीं',
      },
    },
    demosIndex: {
      seo: {
        title: 'डेमो — Aster Lang',
        description: 'इंटरैक्टिव डेमो: एक क्रेडिट निर्णय को फिर से चलाएँ, उद्योग शब्दावली में नियम लिखें, और एक मज़ेदार कैट-मूड इंजन।',
      },
      eyebrow: 'डेमो',
      title: 'Aster को क्रिया में देखें',
      subtitle: 'तीन लाइव डेमो — हर एक आपके ब्राउज़र में असली इंजन चलाता है, बिना साइनअप।',
      enter: 'डेमो खोलें',
      cards: {
        credit: {
          title: 'एक क्रेडिट निर्णय फिर से चलाएँ',
          description: 'एक वास्तविक ऋण-स्वीकृति नियम एक आवेदन पर निर्णय लेता है — फिर ठीक से फिर से चलाएँ कि कैसे, वह उत्तर जो आप नियामक को देते हैं। बाइट-दर-बाइट दो-इंजन जाँच और सत्यापन-योग्य निर्णय हैश के साथ।',
        },
        vocab: {
          title: 'डोमेन शब्दावली',
          description: 'वही नियम उन शब्दों में लिखें जो आपका उद्योग वास्तव में उपयोग करता है — तीन डोमेन में — और देखें कि यह अपरिवर्तित कंपाइल और चलता है।',
        },
        kitten: {
          title: 'कैट-मूड इंजन 🐱',
          description: 'एक मज़ेदार: एक काव्यात्मक बिल्ली-शब्दावली नियम एक छोटे हाथ से बनाए बिल्ली एनिमेशन को चलाता है। प्रमाण कि Aster नियम सामान्य भाषा की तरह पढ़े जाते हैं।',
        },
      },
    },
    footer: {
      demos: 'डेमो',
    },
    languageSettings: {
      toggleAriaLabel: 'इस टीम के लिए {language} टॉगल करें',
      saveFailed: 'अपडेट नहीं हो सका — कृपया पुनः प्रयास करें',
    },
    demoPage: {
      scenarios: {
        boundaryPass: { label: 'सीमा — स्कोर 660' },
        boundaryFail: { label: 'सीमा — स्कोर 659' },
      },
      boundary: {
        title: 'एक अंक, विपरीत निर्णय',
        hint: 'दो आवेदन, एक क्रेडिट-स्कोर अंक को छोड़कर हर क्षेत्र में समान। देखें निर्णय कैसे पलटता है — और ठीक क्यों, इसे फिर से चलाएँ।',
        passLabel: 'स्कोर 660',
        failLabel: 'स्कोर 659',
        flipNote: 'वही नियम, वही इनपुट — {threshold} सीमा पर 1 अंक का अंतर {pass} को {fail} में बदल देता है। नीचे का रीप्ले उस सटीक चरण को दिखाता है जिसने परिणाम बदला।',
        noFlipNote: 'मौजूदा सीमाओं पर ये दोनों अब भिन्न नहीं हैं — दोनों {pass} लौटाते हैं। 1-अंक सीमा पलटाव देखने के लिए मानक स्कोर सीमा को 660 पर लौटाएँ।',
        identicalExcept: 'क्रेडिट स्कोर को छोड़कर समान',
      },
      dualEngine: {
        title: 'दो इंजन, एक उत्तर',
        hint: 'वही नियम दो स्वतंत्र रूप से निर्मित इंजनों पर चलता है — आपके ब्राउज़र में TypeScript और सर्वर पर JVM (Truffle)। वे बाइट-दर-बाइट सहमत हैं। यही विश्वास की गारंटी है: निर्णय नियम है, उसका कोई एक कार्यान्वयन नहीं।',
        tsLabel: 'TypeScript इंजन (ब्राउज़र)',
        jvmLabel: 'JVM इंजन (सर्वर)',
        agree: 'बाइट-दर-बाइट समान',
        disagree: 'इंजन असहमत — ऐसा कभी नहीं होना चाहिए',
        jvmUnavailable: 'सर्वर इंजन अनुपलब्ध — केवल ब्राउज़र इंजन दिखा रहे हैं',
        checking: 'सर्वर इंजन पर चल रहा है…',
      },
      hash: {
        heading: 'निर्णय हैश',
        sub: 'यह सटीक नियम, इनपुट, निर्णय और तर्क का SHA-256 है। कहीं भी पुनः गणना करें — वही रिकॉर्ड, वही हैश। निर्णय निश्चित रूप से पुनरुत्पादनीय और स्वतंत्र रूप से जाँचने-योग्य है; नियम, इनपुट या परिणाम में कोई भी बदलाव अलग हैश उत्पन्न करता है।',
        computing: 'हैश की गणना हो रही है…',
        unavailable: 'इस ब्राउज़र में हैश अनुपलब्ध',
        copy: 'कॉपी करें',
        copied: 'कॉपी किया गया',
      },
    },
  },
};
