'use client';

import { useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation';
import { useDemoSession } from '@/components/demo';

interface DemoPolicy {
  id: string;
  name: string;
  description: string | null;
  piiFields: string[] | null;
  updatedAt: string;
  _count: {
    executions: number;
  };
}

interface DemoDashboardClientProps {
  translations: {
    title: string;
    subtitle: string;
    stats: {
      policies: string;
      executions: string;
      piiDetected: string;
      timeRemaining: string;
    };
    quickActions: {
      title: string;
      createPolicy: string;
      createPolicyDesc: string;
      executePolicy: string;
      executePolicyDesc: string;
      viewExamples: string;
      viewExamplesDesc: string;
    };
    recentPolicies: {
      title: string;
      viewAll: string;
      noPolicies: string;
      createFirst: string;
    };
  };
}

export function DemoDashboardClient({ translations: t }: DemoDashboardClientProps) {
  const { session, limits, loading: sessionLoading } = useDemoSession();
  const [policies, setPolicies] = useState<DemoPolicy[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchPolicies() {
      try {
        const response = await fetch('/api/demo/policies');
        if (response.ok) {
          const data = await response.json();
          setPolicies(data.policies);
        }
      } catch (error) {
        console.error('Error fetching policies:', error);
      } finally {
        setLoading(false);
      }
    }

    if (session) {
      fetchPolicies();
    }
  }, [session]);

  const totalExecutions = policies.reduce(
    (sum, p) => sum + p._count.executions,
    0
  );

  const totalPiiFields = policies.reduce(
    (sum, p) => sum + (p.piiFields?.length || 0),
    0
  );

  if (sessionLoading || loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-gray-200 animate-pulse rounded" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-gray-200 animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
        <p className="text-gray-600 mt-1">{t.subtitle}</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          label={t.stats.policies}
          value={`${limits?.policies.current || 0}/${limits?.policies.max || 10}`}
          icon="📋"
        />
        <StatCard
          label={t.stats.executions}
          value={totalExecutions.toString()}
          icon="▶️"
        />
        <StatCard
          label={t.stats.piiDetected}
          value={totalPiiFields.toString()}
          icon="🔒"
        />
        <StatCard
          label={t.stats.timeRemaining}
          value={session?.timeRemaining || '--'}
          icon="⏱️"
        />
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          {t.quickActions.title}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <QuickActionCard
            href="/demo/policies/new"
            title={t.quickActions.createPolicy}
            description={t.quickActions.createPolicyDesc}
            icon="➕"
          />
          <QuickActionCard
            href="/demo/execute"
            title={t.quickActions.executePolicy}
            description={t.quickActions.executePolicyDesc}
            icon="▶️"
          />
          <QuickActionCard
            href="/demo/policies/new?example=loan"
            title={t.quickActions.viewExamples}
            description={t.quickActions.viewExamplesDesc}
            icon="📚"
          />
        </div>
      </div>

      {/* Recent Policies */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {t.recentPolicies.title}
          </h2>
          {policies.length > 0 && (
            <Link
              href="/demo/policies"
              className="text-sm text-indigo-600 hover:text-indigo-800"
            >
              {t.recentPolicies.viewAll} →
            </Link>
          )}
        </div>

        {policies.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
            <p className="text-gray-500 mb-4">{t.recentPolicies.noPolicies}</p>
            <Link
              href="/demo/policies/new"
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
            >
              {t.recentPolicies.createFirst}
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200">
            {policies.slice(0, 5).map((policy) => (
              <Link
                key={policy.id}
                href={`/demo/policies/${policy.id}`}
                className="block px-4 py-3 hover:bg-gray-50"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-gray-900">
                      {policy.name}
                    </h3>
                    {policy.description && (
                      <p className="text-sm text-gray-500 truncate max-w-md">
                        {policy.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center space-x-4 text-sm text-gray-500">
                    <span>{policy._count.executions} runs</span>
                    {policy.piiFields && policy.piiFields.length > 0 && (
                      <span className="text-amber-600">
                        🔒 {policy.piiFields.length}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: string;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center space-x-3">
        <span className="text-2xl">{icon}</span>
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-xl font-semibold text-gray-900">{value}</p>
        </div>
      </div>
    </div>
  );
}

function QuickActionCard({
  href,
  title,
  description,
  icon,
}: {
  href: string;
  title: string;
  description: string;
  icon: string;
}) {
  return (
    <Link
      href={href}
      className="block bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md hover:border-indigo-300 transition-all"
    >
      <div className="flex items-start space-x-3">
        <span className="text-2xl">{icon}</span>
        <div>
          <h3 className="text-sm font-medium text-gray-900">{title}</h3>
          <p className="text-sm text-gray-500">{description}</p>
        </div>
      </div>
    </Link>
  );
}
