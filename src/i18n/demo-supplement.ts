/**
 * @module i18n/demo-supplement
 *
 * 信贷 demo 的**本地补充文案**（边界翻转对照 + 双引擎对比）。
 *
 * 为什么不放 `@aster-cloud/ui-messages` npm 包（demoPage 其余文案的来源）：
 * 这两组文案是 **cloud demo 页特有的 UI 文本**，不是与后端 aster-api 共享的语言包内容。
 * 放进共享 npm 包会无谓地胖化它、并引入跨仓发版耦合。故作为**本地补充层**，经
 * `deepMergeMessages` 叠加在加载到的 messages 之上（见 request.ts）。
 *
 * 结构与 demoPage 命名空间对齐（`boundary.*` / `dualEngine.*`），next-intl 用
 * `useTranslations('demoPage')` 即可取到。缺 locale 时由 request.ts 的 en 底座兜底。
 */

import type { Locale } from './config';

type MessageTree = Record<string, unknown>;

/**
 * 各 locale 的 demoPage 补充文案。en 为底座（必全），zh/de/hi 补齐；缺的 key
 * 由 deepMergeMessages 落到 en。
 */
export const DEMO_SUPPLEMENT: Record<Locale, MessageTree> = {
  en: {
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
    },
  },
  zh: {
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
    },
  },
  de: {
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
    },
  },
  hi: {
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
    },
  },
};
