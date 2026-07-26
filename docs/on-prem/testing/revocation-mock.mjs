#!/usr/bin/env node
/**
 * E2E test helper: serves a static SignedRevocationDoc on port 7700.
 * Used by stage 6 (verify revoked entitlement) and stage 8 (test
 * grace-period behavior when the server goes offline).
 *
 * State machine controlled by writing to a JSON file watched by the
 * server. Restart not required; reload happens on each request.
 *
 * Usage:
 *   # 1. write the manifest file (use sign-license.mjs sign-revocation)
 *   node sign-license.mjs sign-revocation --priv-key-file rev.pem \
 *     --version 1 --revoke "e2e-001:security" > revocation.json
 *
 *   # 2. start the server
 *   node revocation-mock.mjs ./revocation.json --port 7700
 *
 *   # 3. (stage 8) simulate outage by killing the server, then later
 *   #    test grace-expired behavior by manipulating the DB row
 *   #    `licenseCache.lastSuccessfulRevocationCheckAt`.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const manifestPath = args[0];
if (!manifestPath) {
  console.error('usage: revocation-mock.mjs <manifest.json> [--port 7700]');
  process.exit(2);
}
const portArg = args[args.indexOf('--port') + 1];
const port = Number(portArg) || 7700;

const server = createServer(async (req, res) => {
  if (req.method !== 'GET') {
    res.writeHead(405).end();
    return;
  }
  if (!req.url || !req.url.startsWith('/revocation.json')) {
    res.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(manifestPath, 'utf8');
    res.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    });
    res.end(body);
    console.error(`[revocation-mock] 200 ${req.method} ${req.url} (${body.length} bytes)`);
  } catch (err) {
    // 不把错误详情（可能含路径/堆栈）回给客户端（CodeQL js/stack-trace-exposure）；
    // 诊断信息仅进服务端日志。
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'manifest read failed' }));
    console.error(`[revocation-mock] 500 ${req.url}: ${err}`);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.error(`[revocation-mock] serving ${manifestPath} on http://127.0.0.1:${port}/revocation.json`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
