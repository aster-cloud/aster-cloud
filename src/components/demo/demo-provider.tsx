'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

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

  const fetchSession = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // 创建或获取会话
      const response = await fetch('/api/demo/session', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to create demo session');
      }

      const data = await response.json();
      setSession(data.session);
      setLimits(data.limits);
    } catch (err) {
      console.error('Error fetching demo session:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const response = await fetch('/api/demo/session');
      if (response.ok) {
        const data = await response.json();
        setSession(data.session);
        setLimits(data.limits);
      }
    } catch (err) {
      console.error('Error refreshing demo session:', err);
    }
  }, []);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

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
