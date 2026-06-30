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
      subtitle: 'Five live demos — each runs the real engine in your browser, no signup.',
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
        poker: {
          title: 'Poker showdown 🃏',
          description: 'A poker-vocabulary rule decides the winning hand at a self-dealing table — and awards the trophy. Same provable engine, just dealt in cards.',
        },
        poem: {
          title: 'The source is a poem 📜',
          description: 'A night poem whose every line IS Aster code — no strings. Running it does not print verse; it executes each line and computes a value. In 中文 / Deutsch / हिन्दी.',
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
    pokerPage: {
      seo: {
        title: 'Poker showdown — Aster Lang',
        description: 'A poker-vocabulary rule decides the winning hand at a self-dealing table. The real engine runs in your browser; the winner gets the trophy.',
      },
      eyebrow: 'Fun demo',
      title: 'Poker showdown engine 🃏',
      subtitle: 'A rule written in poker words decides who wins — the same provable engine as the credit demo, just dealt in cards. The table deals itself, on a loop.',
      player1: 'Player 1',
      player2: 'Player 2',
      phases: {
        shuffling: 'Shuffling…',
        dealing: 'Dealing 9 cards…',
        revealing: 'Cards on the table',
        judging: 'Engine deciding the winner…',
        winner: '{player} wins the pot 🏆',
        tie: 'Split pot — a tie',
      },
      controls: {
        pause: 'Pause',
        resume: 'Resume',
        deal: 'Deal next',
      },
      ruleTitle: 'The rule that decides the winner',
      legendTerm: 'highlighted',
      legend: 'words are poker domain vocabulary, injected into the engine and compiled like any other rule.',
      handsTitle: 'Hand ranking (weakest → strongest)',
      handsHint: 'Each player makes their best five-card hand from their two cards plus the five on the table. The stronger hand wins.',
      hands: {
        high: 'High card',
        pair: 'Pair',
        twoPair: 'Two pair',
        trips: 'Three of a kind',
        straight: 'Straight',
        flush: 'Flush',
        fullHouse: 'Full house',
        quads: 'Four of a kind',
        straightFlush: 'Straight flush',
      },
      footer: 'Domain vocabulary can be anything — credit, claims, or a hand of poker. The engine that deals this table is the same one that decides a loan.',
    },
    poemDemoPage: {
      seo: {
        title: 'The source is a poem — Aster Lang',
        description: 'A night poem whose every line IS Aster code — no string literals. Running it does not print verse; it executes the lines and computes a value. Available in 中文 / Deutsch / हिन्दी.',
      },
      eyebrow: 'Fun demo',
      title: 'The source is a poem 📜',
      subtitle: 'Not a poem stored as text — a poem that IS code. Every line is a real rule (a variable, an arithmetic, a call); there are no string literals. Running it does not print pre-written verse — it executes each line and computes a value. (Shown in 中文 / Deutsch / हिन्दी — switch the site language.)',
      source: {
        title: 'Read the source as a poem',
        hint: 'Every line reads as verse — and every line is a real computation. The nouns are variables, the verbs are operators (aliased keywords). No quotes, no string data.',
        showCanonical: 'Show the same program in plain keywords ↓',
        hideCanonical: 'Hide the plain-keyword version ↑',
        canonicalNote: 'Identical Core IR — the poem is just an alias of this (Module / Rule / Return / × / − / + / apply …).',
      },
      run: {
        title: 'And it runs — each line actually computes',
        hint: 'Substitute {n} and watch every verse line evaluate to a real number.',
        button: 'Run the poem with {n} ▶',
      },
      result: {
        title: 'Each line, evaluated with {n}',
        note: 'Each verse line ran in your browser on the same TypeScript engine that powers the credit and poker demos — these are computed values, not printed strings.',
      },
      cta: {
        title: 'Aster is a real compiler, not a template.',
        subtitle: 'If a poem can compile and compute, your rules — in your own words — certainly can.',
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
      subtitle: '五个在线演示——每个都在你浏览器里跑真引擎，无需注册。',
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
        poker: {
          title: '德州扑克摊牌 🃏',
          description: '一条扑克词汇规则在自动发牌的牌桌上判定赢家——并颁出奖杯。和信贷 demo 同一套可证明引擎，只是换成了纸牌。',
        },
        poem: {
          title: '源码即诗 📜',
          description: '一首夜诗，每一行都是 Aster 代码——没有字符串。运行它不是打印诗句，而是执行每一句、算出值。中文 / Deutsch / हिन्दी。',
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
    pokerPage: {
      seo: {
        title: '德州扑克摊牌 — Aster Lang',
        description: '一条扑克词汇规则在自动发牌的牌桌上判定赢家。真引擎在你浏览器里运行；赢家获得奖杯。',
      },
      eyebrow: '趣味 demo',
      title: '德州扑克摊牌引擎 🃏',
      subtitle: '一条用扑克词写成的规则判定谁赢——和信贷 demo 同一套可证明引擎，只是换成了纸牌。牌桌自动循环发牌。',
      player1: '玩家 1',
      player2: '玩家 2',
      phases: {
        shuffling: '洗牌中…',
        dealing: '发 9 张牌…',
        revealing: '牌已摊开',
        judging: '引擎正在判定赢家…',
        winner: '{player} 赢得彩池 🏆',
        tie: '平分彩池——平局',
      },
      controls: {
        pause: '暂停',
        resume: '继续',
        deal: '发下一手',
      },
      ruleTitle: '判定赢家的规则',
      legendTerm: '高亮',
      legend: '的词是扑克领域词汇，注入引擎后与任何其它规则一样被编译。',
      handsTitle: '牌型强弱（从弱到强）',
      handsHint: '每位玩家用自己的 2 张手牌加桌面 5 张公共牌组出最佳的五张牌，牌型强者赢。',
      hands: {
        high: '高牌',
        pair: '一对',
        twoPair: '两对',
        trips: '三条',
        straight: '顺子',
        flush: '同花',
        fullHouse: '葫芦',
        quads: '四条',
        straightFlush: '同花顺',
      },
      footer: '领域词汇可以是任何领域——信贷、理赔，或一手扑克。发这张牌桌的引擎，和判定一笔贷款的，是同一个。',
    },
    poemDemoPage: {
      seo: {
        title: '源码即诗 — Aster Lang',
        description: '一首夜诗，每一行都是 Aster 代码——没有任何字符串。运行它不是打印诗句，而是执行这些语句、算出值。诗句即代码。',
      },
      eyebrow: '趣味 Demo',
      title: '源码即诗 📜',
      subtitle: '不是把诗存成文字，而是一首本身就是代码的诗。每一行都是真规则（变量、运算、调用），没有任何字符串字面量。运行它不会打印预写诗句——而是执行每一句、算出一个值。',
      source: {
        title: '把源码当诗读',
        hint: '每一行都读作诗句——而每一行都是真计算。名词是变量，动词是运算符（被别名的关键词）。无引号，无字符串数据。',
        showCanonical: '看同一程序的规范关键词版 ↓',
        hideCanonical: '收起规范关键词版 ↑',
        canonicalNote: '完全相同的 Core IR——这首诗只是它的别名（模块 / 规则 / 返回 / 乘以 / 减去 / 加上 / 应用 …）。',
      },
      run: {
        title: '它真的算——逐行跑出求值迹',
        hint: '代入 {n}，看每一句诗求值成一个真实的数。',
        button: '代入 {n} 运行这首诗 ▶',
      },
      result: {
        title: '代入 {n}，逐句求值',
        note: '每一句诗都在你的浏览器里、用驱动信贷与扑克 demo 的同一套 TypeScript 引擎跑出——这些是算出来的值，不是打印的字符串。',
      },
      cta: {
        title: 'Aster 是真编译器，不是模板。',
        subtitle: '如果一首诗都能编译执行，你用自己行业的话写的规则，当然也能。',
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
      subtitle: 'Fünf Live-Demos — jede führt die echte Engine in Ihrem Browser aus, ohne Anmeldung.',
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
        poker: {
          title: 'Poker-Showdown 🃏',
          description: 'Eine Poker-Vokabular-Regel entscheidet am selbst gebenden Tisch über das Siegerblatt — und vergibt den Pokal. Dieselbe beweisbare Engine wie beim Kredit-Demo, nur in Karten.',
        },
        poem: {
          title: 'Der Quelltext ist ein Gedicht 📜',
          description: 'Ein Nachtgedicht, dessen jede Zeile Aster-Code IST — keine Zeichenketten. Es läuft nicht, um Verse auszugeben; es führt jede Zeile aus und berechnet einen Wert. In 中文 / Deutsch / हिन्दी.',
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
    pokerPage: {
      seo: {
        title: 'Poker-Showdown — Aster Lang',
        description: 'Eine Poker-Vokabular-Regel entscheidet am selbst gebenden Tisch über das Siegerblatt. Die echte Engine läuft in deinem Browser; der Gewinner erhält den Pokal.',
      },
      eyebrow: 'Spaß-Demo',
      title: 'Poker-Showdown-Engine 🃏',
      subtitle: 'Eine in Poker-Wörtern geschriebene Regel entscheidet, wer gewinnt — dieselbe beweisbare Engine wie beim Kredit-Demo, nur in Karten. Der Tisch gibt sich selbst, in Schleife.',
      player1: 'Spieler 1',
      player2: 'Spieler 2',
      phases: {
        shuffling: 'Mischen…',
        dealing: 'Gebe 9 Karten…',
        revealing: 'Karten auf dem Tisch',
        judging: 'Engine entscheidet den Gewinner…',
        winner: '{player} gewinnt den Pott 🏆',
        tie: 'Geteilter Pott — unentschieden',
      },
      controls: {
        pause: 'Pause',
        resume: 'Weiter',
        deal: 'Nächste geben',
      },
      ruleTitle: 'Die Regel, die den Gewinner entscheidet',
      legendTerm: 'hervorgehobene',
      legend: 'Wörter sind Poker-Fachvokabular, in die Engine injiziert und wie jede andere Regel kompiliert.',
      handsTitle: 'Blatt-Rangfolge (schwach → stark)',
      handsHint: 'Jeder Spieler bildet sein bestes Fünf-Karten-Blatt aus seinen zwei Karten plus den fünf auf dem Tisch. Das stärkere Blatt gewinnt.',
      hands: {
        high: 'Höchste Karte',
        pair: 'Paar',
        twoPair: 'Zwei Paare',
        trips: 'Drilling',
        straight: 'Straße',
        flush: 'Flush',
        fullHouse: 'Full House',
        quads: 'Vierling',
        straightFlush: 'Straight Flush',
      },
      footer: 'Fachvokabular kann alles sein — Kredit, Schäden oder eine Pokerhand. Die Engine, die diesen Tisch gibt, ist dieselbe, die einen Kredit entscheidet.',
    },
    poemDemoPage: {
      seo: {
        title: 'Der Quelltext ist ein Gedicht — Aster Lang',
        description: 'Ein Nachtgedicht, dessen jede Zeile Aster-Code IST — keine Zeichenketten. Es läuft nicht, um Verse auszugeben, sondern führt die Zeilen aus und berechnet einen Wert. Verse sind Code.',
      },
      eyebrow: 'Spaß-Demo',
      title: 'Der Quelltext ist ein Gedicht 📜',
      subtitle: 'Kein als Text gespeichertes Gedicht — ein Gedicht, das Code IST. Jede Zeile ist eine echte Regel (eine Variable, eine Rechnung, ein Aufruf); es gibt keine Zeichenketten-Literale. Es läuft nicht, um vorgefertigte Verse auszugeben — es führt jede Zeile aus und berechnet einen Wert.',
      source: {
        title: 'Lies den Quelltext als Gedicht',
        hint: 'Jede Zeile liest sich als Vers — und jede Zeile ist eine echte Rechnung. Die Substantive sind Variablen, die Verben sind Operatoren (aliasierte Schlüsselwörter). Keine Anführungszeichen, keine Zeichenketten.',
        showCanonical: 'Dasselbe Programm in einfachen Schlüsselwörtern zeigen ↓',
        hideCanonical: 'Schlüsselwort-Version ausblenden ↑',
        canonicalNote: 'Identische Core-IR — das Gedicht ist nur ein Alias davon (Modul / Regel / gib zurück / × / − / + / wende an …).',
      },
      run: {
        title: 'Und es läuft — jede Zeile rechnet wirklich',
        hint: 'Setze {n} ein und sieh jede Verszeile zu einer echten Zahl auswerten.',
        button: 'Das Gedicht mit {n} ausführen ▶',
      },
      result: {
        title: 'Jede Zeile, ausgewertet mit {n}',
        note: 'Jede Verszeile lief in deinem Browser auf derselben TypeScript-Engine wie die Kredit- und Poker-Demos — das sind berechnete Werte, keine ausgegebenen Zeichenketten.',
      },
      cta: {
        title: 'Aster ist ein echter Compiler, keine Vorlage.',
        subtitle: 'Wenn ein Gedicht kompilieren und laufen kann, können es deine Regeln — in deinen eigenen Worten — erst recht.',
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
      subtitle: 'पाँच लाइव डेमो — हर एक आपके ब्राउज़र में असली इंजन चलाता है, बिना साइनअप।',
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
        poker: {
          title: 'पोकर शोडाउन 🃏',
          description: 'एक पोकर-शब्दावली नियम स्वयं-वितरित मेज़ पर विजयी हाथ तय करता है — और ट्रॉफी देता है। क्रेडिट डेमो जैसा ही प्रमाणयोग्य इंजन, बस पत्तों में।',
        },
        poem: {
          title: 'स्रोत ही एक कविता है 📜',
          description: 'एक रात-कविता जिसकी हर पंक्ति Aster कोड है — कोई स्ट्रिंग नहीं। इसे चलाना पंक्तियाँ छापना नहीं; यह हर पंक्ति को निष्पादित कर एक मान गणना करता है। 中文 / Deutsch / हिन्दी में।',
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
    pokerPage: {
      seo: {
        title: 'पोकर शोडाउन — Aster Lang',
        description: 'एक पोकर-शब्दावली नियम स्वयं-वितरित मेज़ पर विजयी हाथ तय करता है। असली इंजन आपके ब्राउज़र में चलता है; विजेता को ट्रॉफी मिलती है।',
      },
      eyebrow: 'मज़ेदार डेमो',
      title: 'पोकर शोडाउन इंजन 🃏',
      subtitle: 'पोकर शब्दों में लिखा एक नियम तय करता है कौन जीता — क्रेडिट डेमो जैसा ही प्रमाणयोग्य इंजन, बस पत्तों में। मेज़ स्वयं पत्ते बाँटती है, लूप में।',
      player1: 'खिलाड़ी 1',
      player2: 'खिलाड़ी 2',
      phases: {
        shuffling: 'फेंटा जा रहा है…',
        dealing: '9 पत्ते बाँटे जा रहे हैं…',
        revealing: 'पत्ते मेज़ पर',
        judging: 'इंजन विजेता तय कर रहा है…',
        winner: '{player} ने पॉट जीता 🏆',
        tie: 'बँटा पॉट — टाई',
      },
      controls: {
        pause: 'रोकें',
        resume: 'जारी रखें',
        deal: 'अगला बाँटें',
      },
      ruleTitle: 'विजेता तय करने वाला नियम',
      legendTerm: 'हाइलाइट किए',
      legend: 'शब्द पोकर डोमेन शब्दावली हैं, जो इंजन में डाले जाते हैं और किसी भी अन्य नियम की तरह कंपाइल होते हैं।',
      handsTitle: 'हाथ क्रम (कमज़ोर → मज़बूत)',
      handsHint: 'हर खिलाड़ी अपने 2 पत्तों और मेज़ के 5 पत्तों से अपना सर्वश्रेष्ठ पाँच-पत्ता हाथ बनाता है। मज़बूत हाथ जीतता है।',
      hands: {
        high: 'हाई कार्ड',
        pair: 'जोड़ा',
        twoPair: 'दो जोड़े',
        trips: 'तीन एक तरह के',
        straight: 'स्ट्रेट',
        flush: 'फ्लश',
        fullHouse: 'फुल हाउस',
        quads: 'चार एक तरह के',
        straightFlush: 'स्ट्रेट फ्लश',
      },
      footer: 'डोमेन शब्दावली कुछ भी हो सकती है — क्रेडिट, क्लेम, या पोकर का एक हाथ। जो इंजन यह मेज़ बाँटता है, वही एक ऋण तय करता है।',
    },
    poemDemoPage: {
      seo: {
        title: 'स्रोत ही एक कविता है — Aster Lang',
        description: 'एक रात-कविता जिसकी हर पंक्ति Aster कोड है — कोई स्ट्रिंग नहीं। इसे चलाना पंक्तियाँ छापना नहीं, बल्कि उन्हें निष्पादित कर एक मान गणना करना है। पंक्तियाँ ही कोड हैं।',
      },
      eyebrow: 'मज़ेदार डेमो',
      title: 'स्रोत ही एक कविता है 📜',
      subtitle: 'पाठ के रूप में रखी कविता नहीं — एक कविता जो स्वयं कोड है। हर पंक्ति एक असली नियम है (चर, गणना, कॉल); कोई स्ट्रिंग शाब्दिक नहीं। इसे चलाना पहले से लिखी पंक्तियाँ नहीं छापता — यह हर पंक्ति को निष्पादित करता है और एक मान गणना करता है।',
      source: {
        title: 'स्रोत को कविता की तरह पढ़ें',
        hint: 'हर पंक्ति पद्य की तरह पढ़ी जाती है — और हर पंक्ति एक असली गणना है। संज्ञाएँ चर हैं, क्रियाएँ ऑपरेटर (उपनामित कीवर्ड)। कोई उद्धरण नहीं, कोई स्ट्रिंग डेटा नहीं।',
        showCanonical: 'वही प्रोग्राम सादे कीवर्ड में दिखाएँ ↓',
        hideCanonical: 'सादे-कीवर्ड संस्करण छिपाएँ ↑',
        canonicalNote: 'समान Core IR — यह कविता उसी का उपनाम है (मॉड्यूल / नियम / लौटाएं / × / − / + / लागू करें …)।',
      },
      run: {
        title: 'और यह चलता है — हर पंक्ति सचमुच गणना करती है',
        hint: '{n} रखें और देखें हर पंक्ति एक असली संख्या में मूल्यांकित होती है।',
        button: '{n} के साथ कविता चलाएँ ▶',
      },
      result: {
        title: '{n} के साथ, हर पंक्ति का मूल्यांकन',
        note: 'हर पंक्ति आपके ब्राउज़र में उसी TypeScript इंजन पर चली जो क्रेडिट और पोकर डेमो चलाता है — ये गणना किए गए मान हैं, छापी गई स्ट्रिंग नहीं।',
      },
      cta: {
        title: 'Aster एक असली कंपाइलर है, टेम्पलेट नहीं।',
        subtitle: 'अगर एक कविता कंपाइल होकर चल सकती है, तो आपके अपने शब्दों में लिखे नियम ज़रूर चल सकते हैं।',
      },
    },
  },
};
