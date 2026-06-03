/**
 * Snippet template registry invariants.
 */

import { describe, it, expect } from 'vitest';
import {
  getSnippetTemplate,
  listSnippetTemplates,
} from '@/lib/playground/snippet-templates';

describe('snippet template registry', () => {
  it('returns null for unknown ids', () => {
    expect(getSnippetTemplate('does-not-exist')).toBeNull();
  });

  it('returns the registered template for a known id', () => {
    const t = getSnippetTemplate('policy-evaluate-basic');
    expect(t).not.toBeNull();
    expect(t?.id).toBe('policy-evaluate-basic');
    expect(t?.source).toContain('package ');
  });

  it('every template has a non-empty source and stable id format', () => {
    for (const t of listSnippetTemplates()) {
      expect(t.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(t.source.length).toBeGreaterThan(0);
    }
  });

  it('all ids are unique', () => {
    const ids = listSnippetTemplates().map((t) => t.id);
    const set = new Set(ids);
    expect(set.size).toBe(ids.length);
  });
});
