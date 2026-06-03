/**
 * `readStoredMode` must be tolerant to malformed input and to the
 * schema envelope it ships. We exercise the public helper directly
 * because the rest of the component pulls in next-intl, which the
 * vitest env can't resolve.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readStoredMode } from '@/components/docs/DocsSidebarModeToggle';

const KEY = 'aster.docs.sidebar.mode';

beforeEach(() => {
  if (typeof globalThis.window === 'undefined') return;
  globalThis.window.localStorage.clear();
});

function setStored(value: string | null): void {
  if (value === null) {
    globalThis.window.localStorage.removeItem(KEY);
    return;
  }
  globalThis.window.localStorage.setItem(KEY, value);
}

describe('readStoredMode', () => {
  it("returns 'reference' when nothing is stored", () => {
    setStored(null);
    expect(readStoredMode()).toBe('reference');
  });

  it("returns 'tasks' when the envelope says tasks", () => {
    setStored(JSON.stringify({ schemaVersion: 1, mode: 'tasks' }));
    expect(readStoredMode()).toBe('tasks');
  });

  it("returns 'reference' when the envelope says reference", () => {
    setStored(JSON.stringify({ schemaVersion: 1, mode: 'reference' }));
    expect(readStoredMode()).toBe('reference');
  });

  it("returns 'reference' for an unsupported schema version", () => {
    setStored(JSON.stringify({ schemaVersion: 2, mode: 'tasks' }));
    expect(readStoredMode()).toBe('reference');
  });

  it("returns 'reference' for malformed JSON", () => {
    setStored('not json');
    expect(readStoredMode()).toBe('reference');
  });
});
