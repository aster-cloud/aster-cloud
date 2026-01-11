/**
 * Custom Next.js Server with WebSocket LSP Proxy
 *
 * This server extends the standard Next.js server to add WebSocket support
 * for the Aster CNL Language Server Protocol integration.
 *
 * Architecture:
 * Browser (Monaco) <--WebSocket--> This Server <--stdio--> Aster LSP Process
 */

import { createServer, IncomingMessage } from 'http';
import { parse } from 'url';
import next from 'next';
import { WebSocketServer, WebSocket } from 'ws';
import { spawn, ChildProcess } from 'child_process';
import { Duplex } from 'stream';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Track active LSP connections for cleanup
const activeConnections = new Map<WebSocket, ChildProcess>();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  // Create WebSocket server for LSP connections
  const wss = new WebSocketServer({ noServer: true });

  // Handle WebSocket upgrade requests
  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const { pathname } = parse(request.url!, true);

    if (pathname === '/api/lsp') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      // Not an LSP request, destroy the socket
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
          // Invalid header, skip
          buffer = buffer.slice(headerEnd + 4);
          continue;
        }

        const contentLength = parseInt(contentLengthMatch[1], 10);
        const messageStart = headerEnd + 4;
        const messageEnd = messageStart + contentLength;

        if (buffer.length < messageEnd) {
          // Not enough data yet, wait for more
          break;
        }

        const message = buffer.slice(messageStart, messageEnd);
        buffer = buffer.slice(messageEnd);

        // Send to WebSocket client
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
  process.on('SIGTERM', () => {
    console.log('[Server] SIGTERM received, cleaning up...');
    for (const [ws, process] of activeConnections) {
      ws.close();
      process.kill();
    }
    server.close();
  });

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> LSP WebSocket available at ws://${hostname}:${port}/api/lsp`);
  });
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

    // Fallback: try using the bin command
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
