import { describe, it, expect } from 'vitest';
import {
  classifyProseLine,
  extractAsterCode,
  looksLikeMarkdown,
  parseSegments,
} from '@/lib/extract-aster-code';

describe('extractAsterCode', () => {
  it('无围栏时按纯代码契约原样返回（仅去首尾空白）', () => {
    const src = 'Module Loan.\n\nRule approve given score, produce:\n  Return true.';
    expect(extractAsterCode(`\n${src}\n\n`)).toBe(src);
  });

  it('提取 ```aster 围栏块内容，丢弃语言标注与围栏', () => {
    const code = 'Module Loan.\nRule approve given score, produce:\n  Return true.';
    const raw = `这是生成的策略：\n\n\`\`\`aster\n${code}\n\`\`\`\n\n希望有帮助。`;
    expect(extractAsterCode(raw)).toBe(code);
  });

  it('提取无语言标注的 ``` 围栏块（LLM 常省略语言）', () => {
    const code = 'Module X.\nRule r given a, produce:\n  Return a.';
    const raw = `\`\`\`\n${code}\n\`\`\``;
    expect(extractAsterCode(raw)).toBe(code);
  });

  it('优先 aster 块，忽略同输出中的非 aster 块（如 json 示例）', () => {
    const aster = 'Module M.\nRule r given x, produce:\n  Return x.';
    const raw = [
      '输入示例：',
      '```json',
      '{ "x": 1 }',
      '```',
      '策略：',
      '```aster',
      aster,
      '```',
    ].join('\n');
    expect(extractAsterCode(raw)).toBe(aster);
  });

  it('多个 aster 块用空行拼接（策略被拆成多块）', () => {
    const a = 'Module M.';
    const b = 'Rule r given x, produce:\n  Return x.';
    const raw = `\`\`\`aster\n${a}\n\`\`\`\n\n中间说明\n\n\`\`\`aster\n${b}\n\`\`\``;
    expect(extractAsterCode(raw)).toBe(`${a}\n\n${b}`);
  });

  it('无 aster 标注时回退到所有围栏块（避免漏取）', () => {
    const code = 'Module M.\nRule r given x, produce:\n  Return x.';
    const raw = `\`\`\`\n${code}\n\`\`\``;
    expect(extractAsterCode(raw)).toBe(code);
  });

  it('流式中途未闭合围栏仍能取到已累积内容', () => {
    const partial = 'Module M.\nRule r given x, produce:';
    const raw = `生成中...\n\`\`\`aster\n${partial}`;
    expect(extractAsterCode(raw)).toBe(partial);
  });

  it('保留代码块内部缩进（If/Otherwise 块结构不能被破坏）', () => {
    const code =
      'Rule classify given age, produce:\n  If age greater than 18\n    Return "adult".\n  Otherwise\n    Return "minor".';
    const raw = `\`\`\`aster\n${code}\n\`\`\``;
    expect(extractAsterCode(raw)).toBe(code);
  });

  it('info string(```aster title) 仍识别为 aster 块', () => {
    const code = 'Module M.\nRule r given x, produce:\n  Return x.';
    expect(extractAsterCode(`\`\`\`aster loan\n${code}\n\`\`\``)).toBe(code);
  });

  it('空输入返回空串', () => {
    expect(extractAsterCode('')).toBe('');
  });
});

describe('looksLikeMarkdown', () => {
  it('含围栏 → true', () => {
    expect(looksLikeMarkdown('```aster\nModule M.\n```')).toBe(true);
  });
  it('含标题 → true', () => {
    expect(looksLikeMarkdown('# 策略说明\nModule M.')).toBe(true);
  });
  it('含加粗 → true', () => {
    expect(looksLikeMarkdown('这是 **重点** 说明')).toBe(true);
  });
  it('纯代码 → false', () => {
    expect(looksLikeMarkdown('Module M.\nRule r given x, produce:\n  Return x.')).toBe(
      false,
    );
  });
  it('空输入 → false', () => {
    expect(looksLikeMarkdown('')).toBe(false);
  });
});

describe('parseSegments', () => {
  it('散文 + aster 代码块切成两段', () => {
    const raw = '这是生成的策略：\n```aster\nModule M.\n```';
    const segs = parseSegments(raw);
    expect(segs).toEqual([
      { kind: 'prose', text: '这是生成的策略：' },
      { kind: 'code', lang: 'aster', code: 'Module M.' },
    ]);
  });

  it('纯代码（无围栏、合规输出）渲染为 code 段而非 prose', () => {
    // 后端契约要求纯 aster 代码；模型遵守时应仍显示为 code 盒（mono），
    // 不退化成普通段落。
    const code = 'Module M.\nRule r given x, produce:\n  Return x.';
    const segs = parseSegments(code);
    expect(segs).toEqual([{ kind: 'code', lang: '', code }]);
  });

  it('无围栏但明显是 markdown 散文 → prose 段', () => {
    const segs = parseSegments('# 说明\n这是一段 **描述** 文字');
    expect(segs).toHaveLength(1);
    expect(segs[0].kind).toBe('prose');
  });

  it('info string(```aster title) 语言只取首 token', () => {
    const code = 'Module M.';
    const segs = parseSegments(`\`\`\`aster loan policy\n${code}\n\`\`\``);
    expect(segs).toEqual([{ kind: 'code', lang: 'aster', code }]);
  });

  it('流式未闭合围栏归为代码段（实时渲染）', () => {
    const segs = parseSegments('生成中\n```aster\nModule M.');
    expect(segs[0]).toEqual({ kind: 'prose', text: '生成中' });
    expect(segs[1]).toEqual({ kind: 'code', lang: 'aster', code: 'Module M.' });
  });

  it('代码块保留内部缩进', () => {
    const code = 'Rule r given a:\n  If a\n    Return 1.';
    const segs = parseSegments(`\`\`\`aster\n${code}\n\`\`\``);
    expect(segs).toEqual([{ kind: 'code', lang: 'aster', code }]);
  });

  it('空输入返回空数组', () => {
    expect(parseSegments('')).toEqual([]);
  });
});

describe('classifyProseLine', () => {
  it('规范标题 `### 文字`', () => {
    expect(classifyProseLine('### 改进片段')).toEqual({
      kind: 'heading',
      level: 3,
      text: '改进片段',
    });
  });

  it('省略空格直接跟标点 `###.文字`（用户实测场景）', () => {
    expect(classifyProseLine('###.白名单应抽成常量')).toEqual({
      kind: 'heading',
      level: 3,
      text: '白名单应抽成常量',
    });
  });

  it('完全无空格 `###文字`', () => {
    expect(classifyProseLine('###文字')).toEqual({
      kind: 'heading',
      level: 1 * 3,
      text: '文字',
    });
  });

  it('一级/二级标题层级正确', () => {
    expect(classifyProseLine('# 一级').kind).toBe('heading');
    expect((classifyProseLine('# 一级') as { level: number }).level).toBe(1);
    expect((classifyProseLine('## 二级') as { level: number }).level).toBe(2);
  });

  it('中文冒号分隔 `###：文字`', () => {
    expect(classifyProseLine('###：小节')).toEqual({
      kind: 'heading',
      level: 3,
      text: '小节',
    });
  });

  it('bare `###` / `####` 不误判为标题', () => {
    expect(classifyProseLine('###').kind).toBe('text');
    expect(classifyProseLine('####').kind).toBe('text');
  });

  it('无序列表 `- 项` / `* 项`', () => {
    expect(classifyProseLine('- 拷贝到剪贴板')).toEqual({
      kind: 'list',
      text: '拷贝到剪贴板',
    });
    expect(classifyProseLine('* 插入到光标')).toEqual({
      kind: 'list',
      text: '插入到光标',
    });
  });

  it('普通段落 → text', () => {
    expect(classifyProseLine('这是一段普通说明文字')).toEqual({
      kind: 'text',
      text: '这是一段普通说明文字',
    });
  });
});
