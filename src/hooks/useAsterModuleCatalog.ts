'use client';

import { useEffect, useState } from 'react';
import type { AsterModuleCatalogEntry } from '@/services/policy/policy-api';

export interface UseAsterModuleCatalogResult {
  modules: AsterModuleCatalogEntry[];
  loading: boolean;
  error: Error | null;
}

let cachedModules: AsterModuleCatalogEntry[] | null = null;

function normalizeCatalogPayload(payload: unknown): AsterModuleCatalogEntry[] {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return [];
  }

  const modules = (payload as { modules?: unknown }).modules;
  if (!Array.isArray(modules)) {
    return [];
  }

  return modules.filter((module): module is AsterModuleCatalogEntry => {
    if (module === null || typeof module !== 'object' || Array.isArray(module)) {
      return false;
    }
    const item = module as Partial<AsterModuleCatalogEntry>;
    return (
      typeof item.moduleName === 'string' &&
      typeof item.functionName === 'string' &&
      Array.isArray(item.versions)
    );
  });
}

export function useAsterModuleCatalog(enabled = true): UseAsterModuleCatalogResult {
  const [modules, setModules] = useState<AsterModuleCatalogEntry[]>(() => cachedModules ?? []);
  const [loading, setLoading] = useState(enabled && cachedModules === null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    if (cachedModules !== null) {
      setModules(cachedModules);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch('/api/aster/modules/catalog', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Module catalog request failed: HTTP ${response.status}`);
        }
        return response.json();
      })
      .then((payload) => {
        const nextModules = normalizeCatalogPayload(payload);
        cachedModules = nextModules;
        setModules(nextModules);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        setError(err instanceof Error ? err : new Error('Failed to load module catalog'));
        setModules(cachedModules ?? []);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [enabled]);

  return { modules, loading, error };
}
