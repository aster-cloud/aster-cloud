/**
 * 「流行歌曲即源码」demo 配置(中文 zh 专属彩蛋)。
 *
 * 一段以周杰伦歌名/歌词领字写成的 `.aster` 源码——读起来像歌,却由生产同款浏览器 TS 引擎
 * 逐字真编译、真执行:三个歌名当布尔前提(晴天 / 青花瓷 / 双截棍),点执行后引擎裁决出一种
 * 「简笔画风格」,决策驱动一段程序化 SVG 周杰伦简笔画(零外部资源、CSP 友好,同 cat-mood 模式)。
 *
 * ★诚实契约(已用生产引擎实证,见 pop-song-demo.compile.test.ts):
 *  1. 歌词体源码用「周杰伦别名词典」编译成功(无诊断错误)。关键词别名(ADR 0022)把歌名/领字
 *     变结构关键词:七里香→模块 / 画面→规则 / 心情→给定 / 于是→产出 / 若→如果 / 画→返回。
 *  2. 歌词体版 ≡ 规范关键词版(剥 origin 后结构一致 Core IR)——证明别名只在 canonicalize 表层,
 *     Lexer/Parser/Core IR 不知歌名存在。
 *  3. 引擎真裁决:四种前提组合 evaluate 出四种风格(sunny/chinese/kungfu/default),翻前提即变。
 *
 * ★为什么 IF 别名用「若」不用「当」:实测「当」在 ZH_CN 下与既有 token 冲突("Unknown statement"),
 *   「若/若时/假使」均可;「若」最贴歌词语气。
 */
import { ZH_CN } from '@aster-cloud/aster-lang-ts/browser';
import type { Lexicon } from '@aster-cloud/aster-lang-ts/browser';

/** SemanticTokenKind 字面量(与 token-kind.ts 对齐,避免运行时依赖内部枚举)。 */
const K = {
  MODULE_DECL: 'MODULE_DECL',
  FUNC_TO: 'FUNC_TO',
  FUNC_GIVEN: 'FUNC_GIVEN',
  FUNC_PRODUCE: 'FUNC_PRODUCE',
  IF: 'IF',
  RETURN: 'RETURN',
} as const;

/** 四种简笔画风格(裁决 key → SVG 场景)。 */
export type SketchStyle = 'sunny' | 'chinese' | 'kungfu' | 'default';

/** 一个可拨动的「歌名前提」(布尔输入)。 */
export interface SongToggle {
  /** 规范入参名(传给 evaluate,= 歌名)。 */
  name: string;
  /** 展示给用户的歌名 + 一句意象注解。 */
  label: string;
  /** 命中该前提时输出的风格(与源码 If 分支顺序一致,供前端预判展示,真值仍由 evaluate 给)。 */
  style: SketchStyle;
}

/** 「流行歌曲即源码」的完整配置。 */
export interface PopSongConfig {
  /** 标题(展示)。 */
  title: string;
  /** 题解(展示)。 */
  attribution: string;
  /** 叠加周杰伦别名的 Lexicon。 */
  lexicon: Lexicon;
  /** 歌词体源码(歌名/领字即代码)。 */
  source: string;
  /** 规范关键词版(证明歌词体 ≡ 规范版,结构一致 Core IR)。 */
  canonical: string;
  /** 入口 rule 名(规范名;歌词体与规范版共用)。 */
  entry: string;
  /** 可拨动的歌名前提(布尔输入,按源码 If 分支顺序)。 */
  toggles: SongToggle[];
  /** 全部前提为假时的裁决风格(源码末行 default)。 */
  defaultStyle: SketchStyle;
}

const JAY_ZH = 'jay-zh';

/**
 * 三个歌名当布尔前提,引擎按 If 顺序裁决出简笔画风格:
 *  - 《晴天》→ sunny(阳光下弹吉他)
 *  - 《青花瓷》→ chinese(执笔如执瓷,中国风)
 *  - 《双截棍》→ kungfu(双截棍武术姿)
 *  - 都无 → default(戴帽低头的经典侧影)
 * If 顺序即优先级(晴天 > 青花瓷 > 双截棍),与规范版逐字一致。
 */
export const POP_SONG: PopSongConfig = {
  title: '流行歌曲即源码',
  attribution: '周杰伦歌名即前提 · 源码即歌,运行裁决出一幅简笔画',
  lexicon: {
    ...ZH_CN,
    id: JAY_ZH,
    name: '周杰伦(中文)',
    aliases: {
      [K.MODULE_DECL]: ['七里香'], // 歌名《七里香》作模块名领字
      [K.FUNC_TO]: ['画面'], // 「画面 感」→ 规则
      [K.FUNC_GIVEN]: ['心情'], // 「心情 是」→ 给定(前提参数表)
      [K.FUNC_PRODUCE]: ['于是'], // 「于是 提笔」→ 产出(块起始)
      [K.IF]: ['若'], // 「若 晴天」→ 如果
      [K.RETURN]: ['画'], // 「画 一个」→ 返回
    },
  } as Lexicon,
  source: `七里香 的夏天。
画面 简笔画 心情 晴天 作为 布尔, 青花瓷 作为 布尔, 双截棍 作为 布尔 于是 提笔:
  若 晴天:
    画 "sunny".
  若 青花瓷:
    画 "chinese".
  若 双截棍:
    画 "kungfu".
  画 "default".`,
  canonical: `模块 的夏天。
规则 简笔画 给定 晴天 作为 布尔, 青花瓷 作为 布尔, 双截棍 作为 布尔 产出 提笔:
  如果 晴天:
    返回 "sunny".
  如果 青花瓷:
    返回 "chinese".
  如果 双截棍:
    返回 "kungfu".
  返回 "default".`,
  entry: '简笔画',
  toggles: [
    { name: '晴天', label: '《晴天》· 故事的小黄花,从出生那年就飘着', style: 'sunny' },
    { name: '青花瓷', label: '《青花瓷》· 素胚勾勒出青花,笔锋浓转淡', style: 'chinese' },
    { name: '双截棍', label: '《双截棍》· 快使用双截棍,哼哼哈兮', style: 'kungfu' },
  ],
  defaultStyle: 'default',
};
