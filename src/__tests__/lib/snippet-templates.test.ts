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
    // Canonical Aster CNL syntax — every template declares a Module
    // and at least one Rule (the legacy Rego-style `package` /
    // `allow if {}` snippets were retired with the unified parser).
    expect(t?.source).toMatch(/^Module\b|\nModule\b/);
    expect(t?.source).toContain('Rule ');
  });

  it('every template has a non-empty source and stable id format', () => {
    for (const t of listSnippetTemplates()) {
      expect(t.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(t.source.length).toBeGreaterThan(0);
      // Canonical syntax invariant for the whole registry.
      expect(t.source).toContain('Module ');
      expect(t.source).toContain('Rule ');
    }
  });

  it('all ids are unique', () => {
    const ids = listSnippetTemplates().map((t) => t.id);
    const set = new Set(ids);
    expect(set.size).toBe(ids.length);
  });

  it('covers every template id advertised by the docs page-actions registry', async () => {
    const { PAGE_ACTIONS } = await import('@/lib/docs/page-actions');
    const expectedIds = new Set<string>();
    for (const set of Object.values(PAGE_ACTIONS)) {
      const all = [set.primary, ...(set.secondary ?? [])];
      for (const action of all) {
        if (!action.id.startsWith('playground_')) continue;
        const m = action.href.match(/[?&]template=([^&]+)/);
        if (m) expectedIds.add(decodeURIComponent(m[1]));
      }
    }
    expect(expectedIds.size).toBeGreaterThan(0);
    for (const id of expectedIds) {
      expect(
        getSnippetTemplate(id),
        `template id "${id}" is referenced by page-actions but missing from the registry`,
      ).not.toBeNull();
    }
  });
});
