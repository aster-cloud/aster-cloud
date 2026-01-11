/**
 * Standalone Aster LSP WebSocket Server
 *
 * This is a lightweight WebSocket server that proxies connections
 * to the Aster CNL Language Server. Designed to run as a separate
 * microservice in Kubernetes while the main app runs on Vercel.
 *
 * Architecture:
 * Browser (Monaco) <--WebSocket--> This Server <--stdio--> Aster LSP Process
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { spawn, ChildProcess } from 'child_process';
import { Duplex } from 'stream';

const hostname = process.env.HOSTNAME || '0.0.0.0';
const port = parseInt(process.env.PORT || '3001', 10);

// CORS configuration
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://aster-lang.cloud,https://www.aster-lang.cloud,http://localhost:3000').split(',');

// Track active LSP connections for cleanup
const activeConnections = new Map<WebSocket, ChildProcess>();

// Create HTTP server for health checks and WebSocket upgrade
const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const { pathname } = parse(req.url!, true);

  // CORS headers
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check endpoint
  if (pathname === '/health' || pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      service: 'aster-lsp',
      activeConnections: activeConnections.size,
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  // Readiness check
  if (pathname === '/ready') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ready',
      service: 'aster-lsp',
    }));
    return;
  }

  // Info endpoint
  if (pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      service: 'Aster CNL Language Server Proxy',
      version: '1.0.0',
      websocket: '/lsp',
      health: '/health',
    }));
    return;
  }

  // 404 for other paths
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// Create WebSocket server for LSP connections
const wss = new WebSocketServer({ noServer: true });

// Handle WebSocket upgrade requests
server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
  const { pathname } = parse(request.url!, true);

  // Check origin for WebSocket connections
  const origin = request.headers.origin;
  if (origin && !allowedOrigins.includes(origin)) {
    console.log(`[LSP] Rejected connection from unauthorized origin: ${origin}`);
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  if (pathname === '/lsp') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Handle new WebSocket connections
wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
  console.log('[LSP] New WebSocket connection');

  // Parse query parameters for locale
  const { query } = parse(request.url!, true);
  const locale = (query.locale as string) || 'en-US';

  // Spawn the Aster LSP server process
  const lspProcess = spawnLSPServer(locale);

  if (!lspProcess) {
    console.error('[LSP] Failed to spawn LSP server');
    ws.close(1011, 'Failed to start language server');
    return;
  }

  activeConnections.set(ws, lspProcess);

  // Forward messages from WebSocket to LSP process (stdin)
  ws.on('message', (data: Buffer | string) => {
    if (lspProcess.stdin && !lspProcess.stdin.destroyed) {
      const message = data.toString();
      // LSP messages need Content-Length header
      const content = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`;
      lspProcess.stdin.write(content);
    }
  });

  // Forward messages from LSP process (stdout) to WebSocket
  let buffer = '';
  lspProcess.stdout?.on('data', (data: Buffer) => {
    buffer += data.toString();

    // Parse LSP messages (Content-Length header format)
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = buffer.slice(0, headerEnd);
      const contentLengthMatch = header.match(/Content-Length: (\d+)/i);
      if (!contentLengthMatch) {
        buffer = buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;

      if (buffer.length < messageEnd) break;

      const message = buffer.slice(messageStart, messageEnd);
      buffer = buffer.slice(messageEnd);

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  });

  // Handle LSP process errors
  lspProcess.stderr?.on('data', (data: Buffer) => {
    console.error('[LSP stderr]', data.toString());
  });

  lspProcess.on('error', (error) => {
    console.error('[LSP] Process error:', error);
    ws.close(1011, 'Language server error');
  });

  lspProcess.on('exit', (code, signal) => {
    console.log(`[LSP] Process exited with code ${code}, signal ${signal}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1000, 'Language server stopped');
    }
    activeConnections.delete(ws);
  });

  // Handle WebSocket close
  ws.on('close', () => {
    console.log('[LSP] WebSocket closed');
    cleanupLSPProcess(ws);
  });

  // Handle WebSocket errors
  ws.on('error', (error) => {
    console.error('[LSP] WebSocket error:', error);
    cleanupLSPProcess(ws);
  });

  console.log(`[LSP] Connection established with locale: ${locale}`);
});

// Cleanup on server shutdown
const shutdown = () => {
  console.log('[Server] Shutting down...');
  for (const [ws, process] of activeConnections) {
    ws.close();
    process.kill();
  }
  server.close(() => {
    console.log('[Server] Closed');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
server.listen(port, hostname, () => {
  console.log(`> Aster LSP Server ready on http://${hostname}:${port}`);
  console.log(`> WebSocket endpoint: ws://${hostname}:${port}/lsp`);
  console.log(`> Health check: http://${hostname}:${port}/health`);
});

/**
 * Spawn the Aster LSP server process
 */
function spawnLSPServer(locale: string): ChildProcess | null {
  try {
    // Try to find the LSP server in node_modules
    const lspServerPath = require.resolve(
      '@aster-cloud/aster-lang-ts/dist/src/lsp/server.js'
    );

    const lspProcess = spawn('node', [lspServerPath, '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ASTER_LOCALE: locale,
      },
    });

    return lspProcess;
  } catch (error) {
    console.error('[LSP] Failed to resolve LSP server path:', error);

    // Fallback: try using npx
    try {
      const lspProcess = spawn('npx', ['aster-lsp', '--stdio'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ASTER_LOCALE: locale,
        },
      });

      return lspProcess;
    } catch (fallbackError) {
      console.error('[LSP] Fallback also failed:', fallbackError);
      return null;
    }
  }
}

/**
 * Cleanup LSP process when WebSocket closes
 */
function cleanupLSPProcess(ws: WebSocket): void {
  const lspProcess = activeConnections.get(ws);
  if (lspProcess) {
    if (!lspProcess.killed) {
      lspProcess.kill('SIGTERM');
    }
    activeConnections.delete(ws);
  }
}
