import { describe, it, expect } from 'vitest';
import {
  parseTraceparent,
  newTraceContext,
  childSpan,
  ensureTraceContext,
} from '@/lib/trace-context';

describe('parseTraceparent', () => {
  it('valid header → 解析成功', () => {
    const ctx = parseTraceparent('00-1234567890abcdef1234567890abcdef-1234567890abcdef-01');
    expect(ctx).not.toBeNull();
    expect(ctx!.traceId).toBe('1234567890abcdef1234567890abcdef');
    expect(ctx!.spanId).toBe('1234567890abcdef');
    expect(ctx!.flags).toBe('01');
  });

  it('null / undefined → null', () => {
    expect(parseTraceparent(null)).toBeNull();
    expect(parseTraceparent(undefined)).toBeNull();
    expect(parseTraceparent('')).toBeNull();
  });

  it('版本不是 00 → 不接受', () => {
    expect(
      parseTraceparent('01-1234567890abcdef1234567890abcdef-1234567890abcdef-01')
    ).toBeNull();
  });

  it('traceId 长度错 → null', () => {
    expect(parseTraceparent('00-deadbeef-1234567890abcdef-01')).toBeNull();
  });

  it('spanId 长度错 → null', () => {
    expect(parseTraceparent('00-1234567890abcdef1234567890abcdef-deadbeef-01')).toBeNull();
  });

  it('包含非 hex 字符 → null', () => {
    expect(
      parseTraceparent('00-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX-1234567890abcdef-01')
    ).toBeNull();
  });

  it('两端空白被剥离', () => {
    const ctx = parseTraceparent('  00-1234567890abcdef1234567890abcdef-1234567890abcdef-01  ');
    expect(ctx).not.toBeNull();
  });
});

describe('newTraceContext', () => {
  it('生成的 traceId 32 hex 字符', () => {
    const ctx = newTraceContext();
    expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('生成的 spanId 16 hex 字符', () => {
    const ctx = newTraceContext();
    expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('flags = 01 (sampled)', () => {
    expect(newTraceContext().flags).toBe('01');
  });

  it('traceparent 格式与字段一致', () => {
    const ctx = newTraceContext();
    expect(ctx.traceparent).toBe(`00-${ctx.traceId}-${ctx.spanId}-${ctx.flags}`);
  });

  it('不同实例 traceId 不同（随机性）', () => {
    const a = newTraceContext();
    const b = newTraceContext();
    expect(a.traceId).not.toBe(b.traceId);
    expect(a.spanId).not.toBe(b.spanId);
  });
});

describe('childSpan', () => {
  it('继承父 traceId 但 spanId 不同', () => {
    const parent = newTraceContext();
    const child = childSpan(parent);
    expect(child.traceId).toBe(parent.traceId);
    expect(child.spanId).not.toBe(parent.spanId);
  });

  it('flags 继承父', () => {
    const parent = newTraceContext();
    const child = childSpan(parent);
    expect(child.flags).toBe(parent.flags);
  });

  it('多次 childSpan 互不相同', () => {
    const parent = newTraceContext();
    const a = childSpan(parent);
    const b = childSpan(parent);
    expect(a.spanId).not.toBe(b.spanId);
    expect(a.traceId).toBe(b.traceId); // 但同一 trace
  });
});

describe('ensureTraceContext', () => {
  it('入站请求带合法 traceparent → 透传', () => {
    const incoming = '00-aabbccddeeff00112233445566778899-1122334455667788-01';
    const req = { headers: { get: (n: string) => (n === 'traceparent' ? incoming : null) } };
    const ctx = ensureTraceContext(req);
    expect(ctx.traceparent).toBe(incoming);
  });

  it('入站缺失 traceparent → 新建 root', () => {
    const req = { headers: { get: () => null } };
    const ctx = ensureTraceContext(req);
    expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('入站非法格式 → 忽略并新建', () => {
    const req = { headers: { get: () => 'not-a-traceparent' } };
    const ctx = ensureTraceContext(req);
    expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(ctx.traceparent).not.toBe('not-a-traceparent');
  });
});
