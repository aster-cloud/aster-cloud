'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  MOCK_DEMO_SESSION,
  MOCK_DEMO_LIMITS,
  getUpdatedTimeRemaining,
} from '@/data/demo-mock-data';

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

  const initMockSession = useCallback(() => {
    // 使用模拟数据初始化会话
    setSession({
      ...MOCK_DEMO_SESSION,
      timeRemaining: getUpdatedTimeRemaining(),
    });
    setLimits(MOCK_DEMO_LIMITS);
    setLoading(false);
    setError(null);
  }, []);

  const refreshSession = useCallback(async () => {
    // 刷新时更新剩余时间
    setSession(prev => prev ? {
      ...prev,
      timeRemaining: getUpdatedTimeRemaining(),
    } : null);
  }, []);

  useEffect(() => {
    // 模拟短暂加载延迟
    const timer = setTimeout(() => {
      initMockSession();
    }, 100);

    return () => clearTimeout(timer);
  }, [initMockSession]);

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
