'use client';

import { ReactNode, useEffect, useState } from 'react';
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
    } else if (!sessionLoading) {
      // Session 不存在且不在加载中，直接结束加载状态
      setLoading(false);
    }
  }, [session, sessionLoading]);

  const totalExecutions = policies.reduce((sum, policy) => sum + policy._count.executions, 0);
  const totalPiiFields = policies.reduce((sum, policy) => sum + (policy.piiFields?.length || 0), 0);

  if (sessionLoading || loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-gray-200" />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((card) => (
            <div key={card} className="h-28 rounded-lg bg-gray-200 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const policiesCurrent = limits?.policies?.current ?? 0;
  const policiesMax = limits?.policies?.max ?? limits?.maxPolicies ?? 10;

  const statCards = [
    {
      key: 'policies',
      label: t.stats.policies,
      value: `${policiesCurrent}/${policiesMax}`,
      icon: <DocumentIcon className="h-5 w-5" />,
      iconWrapperClass: 'bg-indigo-50 text-indigo-600',
      progress: limits?.policies ? { current: policiesCurrent, max: policiesMax } : undefined,
    },
    {
      key: 'executions',
      label: t.stats.executions,
      value: totalExecutions.toString(),
      icon: <PlayIcon className="h-5 w-5" />,
      iconWrapperClass: 'bg-emerald-50 text-emerald-600',
    },
    {
      key: 'pii',
      label: t.stats.piiDetected,
      value: totalPiiFields.toString(),
      icon: <ShieldIcon className="h-5 w-5" />,
      iconWrapperClass: 'bg-amber-50 text-amber-600',
    },
    {
      key: 'time',
      label: t.stats.timeRemaining,
      value: session?.timeRemaining || '--',
      icon: <ClockIcon className="h-5 w-5" />,
      iconWrapperClass: 'bg-slate-50 text-slate-600',
    },
  ];

  const quickActions = [
    {
      key: 'create',
      href: '/demo/policies/new',
      title: t.quickActions.createPolicy,
      description: t.quickActions.createPolicyDesc,
      icon: <PlusIcon className="h-5 w-5" />,
      iconWrapperClass: 'bg-indigo-50 text-indigo-600',
    },
    {
      key: 'execute',
      href: '/demo/execute',
      title: t.quickActions.executePolicy,
      description: t.quickActions.executePolicyDesc,
      icon: <PlayIcon className="h-5 w-5" />,
      iconWrapperClass: 'bg-emerald-50 text-emerald-600',
    },
    {
      key: 'examples',
      href: '/demo/policies/new?example=loan',
      title: t.quickActions.viewExamples,
      description: t.quickActions.viewExamplesDesc,
      icon: <BookIcon className="h-5 w-5" />,
      iconWrapperClass: 'bg-purple-50 text-purple-600',
    },
  ];

  const hasPolicies = policies.length > 0;
  const visiblePolicies = policies.slice(0, 5);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t.title}</h1>
        <p className="mt-1 text-gray-600">{t.subtitle}</p>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map((card) => (
          <StatCard
            key={card.key}
            label={card.label}
            value={card.value}
            icon={card.icon}
            iconWrapperClass={card.iconWrapperClass}
            progress={card.progress}
          />
        ))}
      </div>

      <div>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">{t.quickActions.title}</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {quickActions.map((action) => (
            <QuickActionCard
              key={action.key}
              href={action.href}
              title={action.title}
              description={action.description}
              icon={action.icon}
              iconWrapperClass={action.iconWrapperClass}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">{t.recentPolicies.title}</h2>
          {hasPolicies && (
            <Link href="/demo/policies" className="text-sm text-indigo-600 hover:text-indigo-500">
              {t.recentPolicies.viewAll}
            </Link>
          )}
        </div>

        {hasPolicies ? (
          <div className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-100">
            <ul className="divide-y divide-gray-200">
              {visiblePolicies.map((policy) => (
                <li key={policy.id}>
                  <Link
                    href={`/demo/policies/${policy.id}`}
                    className="block px-4 py-4 hover:bg-gray-50"
                  >
                    <div className="flex items-start justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{policy.name}</p>
                        {policy.description && (
                          <p className="mt-1 text-sm text-gray-500 truncate sm:max-w-xl">
                            {policy.description}
                          </p>
                        )}
                      </div>
                      <div className="ml-4 flex flex-col items-end space-y-2">
                        {policy.piiFields && policy.piiFields.length > 0 && (
                          <span className="inline-flex items-center rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800">
                            {policy.piiFields.length} PII
                          </span>
                        )}
                        <p className="text-xs text-gray-400">
                          {policy._count.executions} runs
                        </p>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="rounded-lg bg-white p-10 text-center shadow-sm ring-1 ring-gray-100">
            <p className="text-gray-500">{t.recentPolicies.noPolicies}</p>
            <Link
              href="/demo/policies/new"
              className="mt-4 inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
            >
              {t.recentPolicies.createFirst}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  icon: ReactNode;
  iconWrapperClass?: string;
  progress?: {
    current: number;
    max: number;
  };
}

function StatCard({
  label,
  value,
  icon,
  iconWrapperClass = 'bg-slate-50 text-slate-600',
  progress,
}: StatCardProps) {
  const safeProgress = progress && progress.max > 0 ? progress : null;
  const progressPercentage = safeProgress
    ? Math.min((safeProgress.current / safeProgress.max) * 100, 100)
    : 0;

  return (
    <div className="overflow-hidden rounded-lg bg-white px-4 py-5 shadow-sm ring-1 ring-gray-100 sm:p-6">
      <div className="flex items-center">
        <div className={`flex-shrink-0 rounded-xl p-3 ${iconWrapperClass}`}>{icon}</div>
        <div className="ml-4">
          <p className="text-sm font-medium text-gray-500">{label}</p>
          <p className="text-2xl font-semibold text-gray-900">{value}</p>
        </div>
      </div>
      {safeProgress && (
        <div className="mt-4">
          <div className="h-2 w-full rounded-full bg-gray-200">
            <div
              className="h-2 rounded-full bg-indigo-600"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-gray-400">
            {safeProgress.current}/{safeProgress.max}
          </p>
        </div>
      )}
    </div>
  );
}

interface QuickActionCardProps {
  href: string;
  title: string;
  description: string;
  icon: ReactNode;
  iconWrapperClass?: string;
}

function QuickActionCard({
  href,
  title,
  description,
  icon,
  iconWrapperClass = 'bg-slate-50 text-slate-600',
}: QuickActionCardProps) {
  return (
    <Link
      href={href}
      className="flex items-center rounded-lg bg-white p-4 shadow-sm ring-1 ring-gray-100 transition-shadow hover:shadow"
    >
      <div className={`flex-shrink-0 rounded-xl p-3 ${iconWrapperClass}`}>{icon}</div>
      <div className="ml-4">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <p className="text-xs text-gray-500">{description}</p>
      </div>
    </Link>
  );
}

interface IconProps {
  className?: string;
}

function DocumentIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.6}
        d="M7 7V5a2 2 0 012-2h6l4 4v10a2 2 0 01-2 2H9a2 2 0 01-2-2V7z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M13 3v4h4" />
    </svg>
  );
}

function PlayIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <circle cx="12" cy="12" r="8.25" strokeWidth={1.6} />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.6}
        d="M11.5 9l4 3-4 3V9z"
      />
    </svg>
  );
}

function ShieldIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.6}
        d="M12 4l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V7l7-3z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M9.5 12.5l2 2 4-4" />
    </svg>
  );
}

function ClockIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <circle cx="12" cy="12" r="8.25" strokeWidth={1.6} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M12 8v4l3 2" />
    </svg>
  );
}

function PlusIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M12 5v14M5 12h14" />
    </svg>
  );
}

function BookIcon({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.6}
        d="M4 7a2 2 0 012-2h5a2 2 0 012 2v12a2 2 0 00-2-2H6a2 2 0 01-2-2V7z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.6}
        d="M20 7a2 2 0 00-2-2h-5a2 2 0 00-2 2v12a2 2 0 012-2h5a2 2 0 012 2V7z"
      />
    </svg>
  );
}
