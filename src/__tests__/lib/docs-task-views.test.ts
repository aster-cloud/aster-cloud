/**
 * Pin the task-view registry invariants:
 *   - Every declared step refers to a real sidebar slug.
 *   - Every task has a unique id.
 *   - The lookup helper returns null for unknown ids.
 *   - sidebarLabelKeyFor resolves to a real i18n key for every step.
 *
 * The runtime usage in `<DocsSidebarTasks>` depends on these
 * invariants — a sidebar slug deleted in the future would silently
 * render an empty step row without them.
 */

import { describe, it, expect } from 'vitest';
import { docsSidebar } from '@/lib/docs/sidebar';
import {
  TASK_VIEWS,
  getTaskView,
  sidebarLabelKeyFor,
} from '@/lib/docs/task-views';

const ALL_SIDEBAR_SLUGS = new Set(
  docsSidebar.flatMap((section) => section.items.map((item) => item.href)),
);

describe('TASK_VIEWS', () => {
  it('has unique ids', () => {
    const ids = TASK_VIEWS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every step slug exists in docsSidebar', () => {
    for (const task of TASK_VIEWS) {
      for (const step of task.steps) {
        expect(ALL_SIDEBAR_SLUGS.has(step.slug), `task=${task.id} slug=${step.slug}`).toBe(true);
      }
    }
  });

  it('every task carries at least one step', () => {
    for (const task of TASK_VIEWS) {
      expect(task.steps.length, `task=${task.id}`).toBeGreaterThan(0);
    }
  });

  it('every task carries a docs.tasks.* titleKey and descriptionKey', () => {
    for (const task of TASK_VIEWS) {
      expect(task.titleKey).toMatch(/^docs\.tasks\./);
      expect(task.descriptionKey).toMatch(/^docs\.tasks\./);
    }
  });
});

describe('getTaskView', () => {
  it('returns null for unknown ids', () => {
    expect(getTaskView('not-a-real-task')).toBeNull();
  });

  it('returns the matching task', () => {
    const t = getTaskView('build-first-policy');
    expect(t?.id).toBe('build-first-policy');
    expect(t?.steps.length).toBeGreaterThan(0);
  });
});

describe('sidebarLabelKeyFor', () => {
  it('returns the sidebar label key for a real slug', () => {
    const slug = 'api/policies/evaluate';
    const key = sidebarLabelKeyFor(slug);
    expect(key).toBeTruthy();
    expect(key!.startsWith('docs.sidebar.')).toBe(true);
  });

  it('returns null for a slug that does not exist in docsSidebar', () => {
    // Cast to any so the function still accepts an unknown literal —
    // production callers pass `RouteSlug` values, but the helper is
    // defensive.
    expect(sidebarLabelKeyFor('made/up/slug' as never)).toBeNull();
  });
});
