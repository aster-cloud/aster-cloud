import { describe, it, expect } from 'vitest';
import { parseSSEFrame } from '@/hooks/useSSEStream';

describe('parseSSEFrame', () => {
  describe('W3C two-line frames (event: + data:)', () => {
    it('PromptScopeFilter rejection: surfaces message, not raw JSON', () => {
      const frame =
        'event: error\ndata: {"error":"out_of_scope","message":"请求未识别为 policy 相关，请描述具体的策略 / 规则 / 合规需求","rule_id":"off-topic-no-keywords"}';
      const e = parseSSEFrame(frame);
      expect(e?.type).toBe('error');
      // user-facing message wins over machine-readable error code
      expect(e?.error).toBe(
        '请求未识别为 policy 相关，请描述具体的策略 / 规则 / 合规需求'
      );
    });

    it('falls back to error code when message is absent', () => {
      const frame = 'event: error\ndata: {"error":"out_of_scope"}';
      const e = parseSSEFrame(frame);
      expect(e?.type).toBe('error');
      expect(e?.error).toBe('out_of_scope');
    });

    it('final event with validated flag', () => {
      const frame =
        'event: final\ndata: {"data":"Module x. Rule y given a: a > 0.","validated":true}';
      const e = parseSSEFrame(frame);
      expect(e?.type).toBe('final');
      expect(e?.data).toBe('Module x. Rule y given a: a > 0.');
      expect(e?.validated).toBe(true);
    });
  });

  describe('Quarkus single-line JSON (type inside payload)', () => {
    it('delta event from inline type field', () => {
      const frame = 'data: {"type":"delta","data":"hello"}';
      const e = parseSSEFrame(frame);
      expect(e?.type).toBe('delta');
      expect(e?.data).toBe('hello');
    });

    it('repair_start with progress data', () => {
      const frame = 'data: {"type":"repair_start","data":"2/5"}';
      const e = parseSSEFrame(frame);
      expect(e?.type).toBe('repair_start');
      expect(e?.data).toBe('2/5');
    });
  });

  describe('fallbacks', () => {
    it('returns null on empty frame', () => {
      expect(parseSSEFrame('')).toBeNull();
      expect(parseSSEFrame('   \n  ')).toBeNull();
    });

    it('SSE comment lines are skipped', () => {
      const frame = ': keep-alive\nevent: error\ndata: {"message":"hi"}';
      const e = parseSSEFrame(frame);
      expect(e?.type).toBe('error');
      expect(e?.error).toBe('hi');
    });

    it('non-JSON delta payload is preserved verbatim', () => {
      const frame = 'data: just a plain text chunk';
      const e = parseSSEFrame(frame);
      expect(e?.type).toBe('delta');
      expect(e?.data).toBe('just a plain text chunk');
    });
  });
});
