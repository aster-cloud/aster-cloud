import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../../../scripts/docs-migration/build-docs-index.mjs';

/**
 * build-docs-index 的 frontmatter 解析契约回归：
 *  - 合法 YAML → 取出 title/description
 *  - 非法 YAML **必须抛**（不静默吞成空 metadata，否则语法错误伪装成"内容缺失"）
 *  - 无 frontmatter / 非对象 → 安全返回空串
 */
describe('build-docs-index parseFrontmatter', () => {
  it('合法 frontmatter → 取出 title/description', () => {
    const md = '---\ntitle: Evaluate Policy\ndescription: Run a deployed policy\n---\n# Body\n';
    expect(parseFrontmatter(md)).toEqual({
      title: 'Evaluate Policy',
      description: 'Run a deployed policy',
    });
  });

  it('非法 YAML frontmatter → 抛出（不吞错）', () => {
    // 未闭合的 flow mapping，yaml 解析器会抛。
    const bad = '---\ntitle: "unterminated\ndescription: { a: 1\n---\nbody\n';
    expect(() => parseFrontmatter(bad)).toThrow();
  });

  it('无 frontmatter → 空 metadata', () => {
    expect(parseFrontmatter('# Just a heading\n')).toEqual({ title: '', description: '' });
  });

  it('frontmatter 是标量而非对象 → 空 metadata', () => {
    expect(parseFrontmatter('---\njust a string\n---\nbody\n')).toEqual({
      title: '',
      description: '',
    });
  });
});
