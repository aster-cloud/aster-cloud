// worker.js can't import from src/ (it's the Cloudflare Workers entry
// before OpenNext bundling), so the cron→route mapping is mirrored
// inline. This test parses worker.js and asserts byte-level agreement
// with CRON_REGISTRY — any drift fails CI before deploy.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { CRON_REGISTRY } from '@/lib/cron-registry';

describe('worker.js CRON_DISPATCH ↔ CRON_REGISTRY parity', () => {
  const workerSrc = readFileSync(
    resolve(process.cwd(), 'worker.js'),
    'utf8',
  );

  it('contains a CRON_DISPATCH object', () => {
    expect(workerSrc).toContain('CRON_DISPATCH');
  });

  it('every registry entry appears verbatim in worker.js', () => {
    for (const job of CRON_REGISTRY) {
      // We look for a `"<cron>": "<route>"` literal — the exact way the
      // dispatcher writes it. Spaces are intentional (the file is
      // hand-formatted, not generated).
      const expected = `"${job.cron}": "${job.routePath}"`;
      expect(workerSrc, `missing in worker.js: ${expected}`).toContain(expected);
    }
  });

  it('worker.js has no extra cron mappings outside the registry', () => {
    // Match every `"<cron>": "<route>"` pair inside CRON_DISPATCH.
    const block = workerSrc.match(/const\s+CRON_DISPATCH\s*=\s*\{([\s\S]*?)\}\s*;/);
    expect(block, 'CRON_DISPATCH object not found in worker.js').toBeTruthy();
    const lines = (block?.[1] ?? '').match(/"([^"]+)":\s*"([^"]+)"/g) ?? [];
    const dispatch = new Map(
      lines.map((line) => {
        const m = /"([^"]+)":\s*"([^"]+)"/.exec(line)!;
        return [m[1], m[2]] as const;
      }),
    );
    const registry = new Map(CRON_REGISTRY.map((c) => [c.cron, c.routePath]));
    expect(dispatch.size).toBe(registry.size);
    for (const [cron, route] of dispatch) {
      expect(registry.get(cron)).toBe(route);
    }
  });
});
