/**
 * 从 AI 助手输出中提取 aster 策略源码。
 *
 * 背景：后端 prompt 明确要求「输出纯 aster 代码，不含 markdown 标记」
 * （policy_gen_*.txt），但 LLM（gpt-5.2）实际常不遵守，会用 ```aster ...
 * ``` 代码块包裹，甚至夹带散文说明。前端必须防御式提取，只把纯 aster
 * 代码插入 Monaco，而非整段 markdown 文本。
 *
 * 提取策略（fence 优先 + 无 fence 回退原文）：
 * 1. 若存在围栏代码块（```...```），取代码块内容——优先带 aster/asterlang
 *    语言标注的块；否则取第一个无语言或任意语言的块。多个 aster 块拼接
 *    （用空行分隔），覆盖 LLM 把一份策略拆成多块的情况。
 * 2. 若无任何围栏，按后端契约视整段为纯代码，去除首尾空白后原样返回。
 */

/** 围栏代码块的语言标注归一化后视为 aster 的集合。 */
const ASTER_FENCE_LANGS = new Set(['aster', 'asterlang', 'aster-lang']);

interface FenceBlock {
  lang: string;
  code: string;
}

/**
 * 解析所有围栏代码块。手写扫描而非正则一把梭，因为要正确处理：
 * - 起始围栏行的语言标注（```aster）
 * - 代码块内部可能出现的非成对反引号
 * - 未闭合的围栏（流式输出中途，取到文本末尾）
 */
function parseFenceBlocks(text: string): FenceBlock[] {
  const lines = text.split('\n');
  const blocks: FenceBlock[] = [];
  let inFence = false;
  let lang = '';
  let buf: string[] = [];

  for (const line of lines) {
    const fenceMatch = /^\s*```(.*)$/.exec(line);
    if (fenceMatch) {
      if (!inFence) {
        // 开围栏：记录语言标注（info string 只取首 token，```aster title→aster）。
        inFence = true;
        lang = fenceMatch[1].trim().toLowerCase().split(/\s+/)[0] ?? '';
        buf = [];
      } else {
        // 闭围栏：落一个块。
        blocks.push({ lang, code: buf.join('\n') });
        inFence = false;
        lang = '';
        buf = [];
      }
      continue;
    }
    if (inFence) buf.push(line);
  }

  // 流式输出中途：围栏已开但未闭，仍收下已累积的内容。
  if (inFence && buf.length > 0) {
    blocks.push({ lang, code: buf.join('\n') });
  }

  return blocks;
}

/**
 * 从 markdown / 纯文本的 AI 输出中提取 aster 源码。
 *
 * @param raw AI 助手的原始输出（可能是纯代码，也可能是含围栏的 markdown）
 * @returns 去除 markdown 标记后的纯 aster 源码；输入为空则返回空串。
 */
export function extractAsterCode(raw: string): string {
  if (!raw) return '';

  const blocks = parseFenceBlocks(raw);

  if (blocks.length > 0) {
    // 优先带 aster 语言标注的块。
    const asterBlocks = blocks.filter((b) => ASTER_FENCE_LANGS.has(b.lang));
    const chosen = asterBlocks.length > 0 ? asterBlocks : blocks;
    // 多块拼接（空行分隔），trim 掉整体首尾空白。
    return chosen
      .map((b) => b.code.replace(/\s+$/, '')) // 去每块尾部空白，保留内部缩进
      .join('\n\n')
      .trim();
  }

  // 无围栏：后端契约本就要求纯代码，原样返回（去首尾空白）。
  return raw.trim();
}

/**
 * 判断 AI 输出是否「看起来像 markdown」（含围栏或常见 markdown 语法）。
 * 用于显示层决定是否走 markdown 渲染。宽松判断即可——渲染器对纯文本
 * 也能安全降级为普通段落。
 */
export function looksLikeMarkdown(raw: string): boolean {
  if (!raw) return false;
  return (
    /```/.test(raw) || // 围栏
    /^#{1,6}\s/m.test(raw) || // 标题
    /^\s*[-*]\s/m.test(raw) || // 无序列表
    /\*\*[^*]+\*\*/.test(raw) // 加粗
  );
}

/** AI 输出显示分段：散文段或代码块，供 markdown 感知渲染。 */
export type OutputSegment =
  | { kind: 'prose'; text: string }
  | { kind: 'code'; lang: string; code: string };

/**
 * 把 AI 输出按 ``` 围栏切成「散文段」与「代码块」序列，供显示层渲染。
 * 流式安全：未闭合的围栏也归为一个代码块（取到当前末尾），随流增长实时
 * 渲染。与 extractAsterCode 的区别：extract 只要代码用于插入编辑器，本函数
 * 保留散文段用于展示。
 */
export function parseSegments(raw: string): OutputSegment[] {
  if (!raw) return [];

  // 无围栏时按后端契约整段视为纯 aster 代码：渲染为 code 段（mono 盒），
  // 不退化成 prose 普通段落——否则模型遵守 no-markdown 契约反而显示更差。
  // 仅当整段看起来像 markdown 散文（标题/列表/加粗）才当 prose。
  if (!raw.includes('```')) {
    const trimmed = raw.replace(/\s+$/, '');
    if (!trimmed.trim()) return [];
    return looksLikeMarkdown(raw)
      ? [{ kind: 'prose', text: trimmed.trim() }]
      : [{ kind: 'code', lang: '', code: trimmed }];
  }

  const lines = raw.split('\n');
  const segments: OutputSegment[] = [];
  let inFence = false;
  let lang = '';
  let buf: string[] = [];

  const flushProse = () => {
    const text = buf.join('\n').trim();
    if (text) segments.push({ kind: 'prose', text });
    buf = [];
  };
  const flushCode = () => {
    segments.push({ kind: 'code', lang, code: buf.join('\n').replace(/\s+$/, '') });
    buf = [];
    lang = '';
  };

  for (const line of lines) {
    const fence = /^\s*```(.*)$/.exec(line);
    if (fence) {
      if (!inFence) {
        flushProse();
        inFence = true;
        // info string 只取首 token 作为语言（```aster title → aster）。
        lang = fence[1].trim().toLowerCase().split(/\s+/)[0] ?? '';
      } else {
        flushCode();
        inFence = false;
      }
      continue;
    }
    buf.push(line);
  }
  // 收尾：未闭合围栏当代码块，否则当散文。
  if (inFence) flushCode();
  else flushProse();
  return segments;
}

/** 散文单行的行级 markdown 分类，供显示层选渲染方式。 */
export type ProseLine =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; text: string }
  | { kind: 'text'; text: string };

/**
 * 判定散文一行是标题 / 列表项 / 普通文本。
 *
 * 标题规范是 `### 文字`（# 后空格），但 LLM 有时省略空格甚至直接跟标点
 * （`###.白名单` / `###文字`）——宽松匹配 # 后可选的空白/前导标点。用
 * `[^#\s]` 起始确保 bare `###` / `####` 不被误判为标题。
 */
export function classifyProseLine(line: string): ProseLine {
  const heading = /^(#{1,6})[ \t]*[.。、:：)]?[ \t]*([^#\s].*)$/.exec(line);
  if (heading) {
    return { kind: 'heading', level: heading[1].length, text: heading[2] };
  }
  const list = /^\s*[-*]\s+(.*)$/.exec(line);
  if (list) {
    return { kind: 'list', text: list[1] };
  }
  return { kind: 'text', text: line };
}
