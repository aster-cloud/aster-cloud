'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  fetchDemoSession,
  refreshDemoSession,
  type SessionResponse,
} from '@/lib/demo-api';

interface DemoSessionData {
  id: string;
  expiresAt: string;
  timeRemaining: string;
  createdAt: string;
}

interface DemoLimits {
  policies: {
    current: number;
    max: number;
  };
  maxPolicies: number;
  sessionTTLHours: number;
}

interface DemoContextValue {
  session: DemoSessionData | null;
  limits: DemoLimits | null;
  loading: boolean;
  error: string | null;
  refreshSession: () => Promise<void>;
}

const DemoContext = createContext<DemoContextValue | null>(null);

export function useDemoSession() {
  const context = useContext(DemoContext);
  if (!context) {
    throw new Error('useDemoSession must be used within a DemoProvider');
  }
  return context;
}

interface DemoProviderProps {
  children: React.ReactNode;
}

export function DemoProvider({ children }: DemoProviderProps) {
  const [session, setSession] = useState<DemoSessionData | null>(null);
  const [limits, setLimits] = useState<DemoLimits | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const initSession = useCallback(async () => {
    try {
      const response = await fetchDemoSession();
      if (response.success && response.data) {
        setSession(response.data.session);
        setLimits(response.data.limits);
        setError(null);
      } else {
        setError(response.error || 'Failed to initialize session');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize session');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const response = await refreshDemoSession();
      if (response.success && response.data) {
        setSession(response.data.session);
        setLimits(response.data.limits);
        setError(null);
      }
    } catch (err) {
      console.error('Failed to refresh session:', err);
    }
  }, []);

  useEffect(() => {
    initSession();
  }, [initSession]);

  // 定时刷新会话状态（每分钟）
  useEffect(() => {
    if (!session) return;

    const interval = setInterval(() => {
      refreshSession();
    }, 60000);

    return () => clearInterval(interval);
  }, [session, refreshSession]);

  const value: DemoContextValue = {
    session,
    limits,
    loading,
    error,
    refreshSession,
  };

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}
