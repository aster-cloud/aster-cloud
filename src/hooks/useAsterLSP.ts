/**
 * useAsterLSP Hook
 *
 * Provides Language Server Protocol integration for the Aster CNL editor.
 * Manages WebSocket connection to the LSP server and Monaco language client.
 *
 * Features:
 * - Real-time diagnostics (parse errors, type errors)
 * - Code completion
 * - Hover information
 * - Go to definition
 * - Find references
 */

'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import type { editor } from 'monaco-editor';

export type CNLLocale = 'en-US' | 'zh-CN' | 'de-DE';

export interface UseAsterLSPOptions {
  /** Monaco editor instance */
  editor: editor.IStandaloneCodeEditor | null;
  /** Document URI for LSP */
  documentUri: string;
  /** CNL language locale */
  locale?: CNLLocale;
  /** Auto-connect on mount */
  autoConnect?: boolean;
  /** Reconnect on disconnect */
  autoReconnect?: boolean;
  /** Reconnect delay in ms */
  reconnectDelay?: number;
}

export interface UseAsterLSPResult {
  /** Whether connected to LSP server */
  connected: boolean;
  /** Whether currently connecting */
  connecting: boolean;
  /** Connection error message */
  error: string | null;
  /** Manually connect to LSP */
  connect: () => Promise<void>;
  /** Manually disconnect from LSP */
  disconnect: () => void;
  /** Reconnect to LSP */
  reconnect: () => Promise<void>;
}

interface LSPMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Hook for integrating Aster CNL Language Server with Monaco editor
 */
export function useAsterLSP({
  editor,
  documentUri,
  locale = 'en-US',
  autoConnect = true,
  autoReconnect = true,
  reconnectDelay = 3000,
}: UseAsterLSPOptions): UseAsterLSPResult {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const requestIdRef = useRef(0);
  const pendingRequestsRef = useRef<Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void }>>(new Map());
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isDisposedRef = useRef(false);

  /**
   * Get the WebSocket URL for LSP connection
   *
   * In production: Connect to external LSP service (NEXT_PUBLIC_LSP_HOST)
   * In development: Connect to local WebSocket server (/api/lsp)
   */
  const getWebSocketUrl = useCallback((): string => {
    if (typeof window === 'undefined') return '';

    // Check for external LSP host (production)
    // Note: NEXT_PUBLIC_* variables are inlined at build time
    const lspHost = process.env.NEXT_PUBLIC_LSP_HOST;

    if (lspHost) {
      // External host - use wss:// and /lsp path
      const protocol = lspHost.startsWith('localhost') ? 'ws:' : 'wss:';
      return `${protocol}//${lspHost}/lsp?locale=${locale}`;
    }

    // Local development - use same host with /api/lsp path
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/api/lsp?locale=${locale}`;
  }, [locale]);

  /**
   * Send an LSP request and wait for response
   */
  const sendRequest = useCallback(
    async <T>(method: string, params?: unknown): Promise<T> => {
      return new Promise((resolve, reject) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          reject(new Error('WebSocket not connected'));
          return;
        }

        const id = ++requestIdRef.current;
        const message: LSPMessage = {
          jsonrpc: '2.0',
          id,
          method,
          params,
        };

        pendingRequestsRef.current.set(id, {
          resolve: resolve as (r: unknown) => void,
          reject,
        });

        ws.send(JSON.stringify(message));
      });
    },
    []
  );

  /**
   * Send an LSP notification (no response expected)
   */
  const sendNotification = useCallback((method: string, params?: unknown): void => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[LSP] Cannot send notification: not connected');
      return;
    }

    const message: LSPMessage = {
      jsonrpc: '2.0',
      method,
      params,
    };

    ws.send(JSON.stringify(message));
  }, []);

  /**
   * Handle incoming LSP messages
   */
  const handleMessage = useCallback((data: string) => {
    try {
      const message: LSPMessage = JSON.parse(data);

      // Handle response to a request
      if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
        const pending = pendingRequestsRef.current.get(message.id as number);
        if (pending) {
          pendingRequestsRef.current.delete(message.id as number);
          if (message.error) {
            pending.reject(new Error(message.error.message));
          } else {
            pending.resolve(message.result);
          }
        }
        return;
      }

      // Handle server notifications
      if (message.method) {
        handleServerNotification(message.method, message.params);
      }
    } catch (e) {
      console.error('[LSP] Failed to parse message:', e);
    }
  }, []);

  /**
   * Handle notifications from the LSP server
   */
  const handleServerNotification = useCallback(
    (method: string, params: unknown) => {
      switch (method) {
        case 'textDocument/publishDiagnostics': {
          // Diagnostics are handled by Monaco's language client
          // This is a fallback for manual handling if needed
          const diagnosticParams = params as {
            uri: string;
            diagnostics: Array<{
              range: { start: { line: number; character: number }; end: { line: number; character: number } };
              message: string;
              severity?: number;
            }>;
          };
          console.log('[LSP] Diagnostics received:', diagnosticParams.diagnostics.length);
          break;
        }
        case 'window/logMessage':
        case 'window/showMessage': {
          const msgParams = params as { type: number; message: string };
          const types = ['', 'Error', 'Warning', 'Info', 'Log'];
          console.log(`[LSP ${types[msgParams.type] || 'Message'}]`, msgParams.message);
          break;
        }
        default:
          console.log('[LSP] Notification:', method);
      }
    },
    []
  );

  /**
   * Initialize LSP connection
   */
  const initializeLSP = useCallback(async () => {
    if (!editor) return;

    try {
      // Send initialize request
      const initResult = await sendRequest('initialize', {
        processId: null,
        rootUri: null,
        capabilities: {
          textDocument: {
            synchronization: {
              dynamicRegistration: true,
              willSave: false,
              didSave: true,
              willSaveWaitUntil: false,
            },
            completion: {
              dynamicRegistration: true,
              completionItem: {
                snippetSupport: true,
                commitCharactersSupport: true,
                documentationFormat: ['markdown', 'plaintext'],
              },
            },
            hover: {
              dynamicRegistration: true,
              contentFormat: ['markdown', 'plaintext'],
            },
            signatureHelp: {
              dynamicRegistration: true,
            },
            definition: {
              dynamicRegistration: true,
            },
            references: {
              dynamicRegistration: true,
            },
            documentHighlight: {
              dynamicRegistration: true,
            },
            documentSymbol: {
              dynamicRegistration: true,
            },
            formatting: {
              dynamicRegistration: true,
            },
            codeAction: {
              dynamicRegistration: true,
            },
            publishDiagnostics: {
              relatedInformation: true,
            },
          },
          workspace: {
            workspaceFolders: false,
            didChangeConfiguration: {
              dynamicRegistration: true,
            },
          },
        },
        initializationOptions: {
          locale,
        },
      });

      console.log('[LSP] Initialized:', initResult);

      // Send initialized notification
      sendNotification('initialized', {});

      // Open the current document
      const model = editor.getModel();
      if (model) {
        sendNotification('textDocument/didOpen', {
          textDocument: {
            uri: documentUri,
            languageId: 'aster-cnl',
            version: model.getVersionId(),
            text: model.getValue(),
          },
        });
      }

      setConnected(true);
      setError(null);
    } catch (e) {
      console.error('[LSP] Initialization failed:', e);
      setError(e instanceof Error ? e.message : 'LSP initialization failed');
      setConnected(false);
    }
  }, [editor, documentUri, locale, sendRequest, sendNotification]);

  /**
   * Connect to the LSP server
   */
  const connect = useCallback(async () => {
    if (isDisposedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setConnecting(true);
    setError(null);

    try {
      const wsUrl = getWebSocketUrl();
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => {
          console.log('[LSP] WebSocket connected');
          resolve();
        };

        ws.onerror = (event) => {
          reject(new Error('WebSocket connection failed'));
        };

        // Timeout after 10 seconds
        setTimeout(() => reject(new Error('Connection timeout')), 10000);
      });

      ws.onmessage = (event) => {
        handleMessage(event.data);
      };

      ws.onclose = (event) => {
        console.log('[LSP] WebSocket closed:', event.code, event.reason);
        setConnected(false);

        // Clear pending requests
        for (const [, pending] of pendingRequestsRef.current) {
          pending.reject(new Error('Connection closed'));
        }
        pendingRequestsRef.current.clear();

        // Auto-reconnect if enabled and not disposed
        if (autoReconnect && !isDisposedRef.current && event.code !== 1000) {
          console.log(`[LSP] Will reconnect in ${reconnectDelay}ms`);
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectDelay);
        }
      };

      ws.onerror = (event) => {
        console.error('[LSP] WebSocket error:', event);
        setError('WebSocket error');
      };

      // Initialize LSP protocol
      await initializeLSP();
    } catch (e) {
      console.error('[LSP] Connection failed:', e);
      setError(e instanceof Error ? e.message : 'Connection failed');
      setConnected(false);

      // Auto-reconnect on failure
      if (autoReconnect && !isDisposedRef.current) {
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, reconnectDelay);
      }
    } finally {
      setConnecting(false);
    }
  }, [getWebSocketUrl, handleMessage, initializeLSP, autoReconnect, reconnectDelay]);

  /**
   * Disconnect from the LSP server
   */
  const disconnect = useCallback(() => {
    // Clear reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close(1000, 'Client disconnect');
      wsRef.current = null;
    }

    // Clear pending requests
    for (const [, pending] of pendingRequestsRef.current) {
      pending.reject(new Error('Disconnected'));
    }
    pendingRequestsRef.current.clear();

    setConnected(false);
    setConnecting(false);
  }, []);

  /**
   * Reconnect to the LSP server
   */
  const reconnect = useCallback(async () => {
    disconnect();
    await connect();
  }, [disconnect, connect]);

  // Auto-connect on mount
  useEffect(() => {
    // Reset disposed flag on mount/remount (important for React Strict Mode)
    isDisposedRef.current = false;

    if (autoConnect && editor) {
      connect();
    }

    return () => {
      isDisposedRef.current = true;
      disconnect();
    };
  }, [autoConnect, editor, connect, disconnect]);

  // Sync document changes to LSP
  useEffect(() => {
    if (!editor || !connected) return;

    const model = editor.getModel();
    if (!model) return;

    const disposable = model.onDidChangeContent(() => {
      sendNotification('textDocument/didChange', {
        textDocument: {
          uri: documentUri,
          version: model.getVersionId(),
        },
        contentChanges: [
          {
            text: model.getValue(),
          },
        ],
      });
    });

    return () => disposable.dispose();
  }, [editor, connected, documentUri, sendNotification]);

  return {
    connected,
    connecting,
    error,
    connect,
    disconnect,
    reconnect,
  };
}
