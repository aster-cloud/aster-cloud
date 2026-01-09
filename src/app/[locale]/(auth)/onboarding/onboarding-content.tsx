'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Link } from '@/i18n/navigation';

const USE_CASE_IDS = ['finance', 'healthcare', 'ecommerce', 'insurance', 'legal', 'other'] as const;
const USE_CASE_ICONS: Record<typeof USE_CASE_IDS[number], string> = {
  finance: '🏦',
  healthcare: '🏥',
  ecommerce: '🛒',
  insurance: '📋',
  legal: '⚖️',
  other: '🔧',
};

const GOAL_IDS = ['pii', 'compliance', 'automation', 'team', 'integration'] as const;

interface Translations {
  brand: string;
  welcome: string;
  industryQuestion: string;
  goalsQuestion: string;
  continue: string;
  back: string;
  starting: string;
  getStarted: string;
  skipForNow: string;
  useCases: Record<typeof USE_CASE_IDS[number], string>;
  goals: Record<typeof GOAL_IDS[number], string>;
}

interface OnboardingContentProps {
  translations: Translations;
}

export function OnboardingContent({ translations: t }: OnboardingContentProps) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [selectedUseCase, setSelectedUseCase] = useState('');
  const [selectedGoals, setSelectedGoals] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const toggleGoal = (goalId: string) => {
    setSelectedGoals((prev) =>
      prev.includes(goalId) ? prev.filter((g) => g !== goalId) : [...prev, goalId]
    );
  };

  const handleComplete = async () => {
    setIsLoading(true);

    // TODO: Save onboarding preferences to user profile
    // await fetch('/api/user/onboarding', {
    //   method: 'POST',
    //   body: JSON.stringify({ useCase: selectedUseCase, goals: selectedGoals }),
    // });

    router.push('/dashboard');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-lg w-full space-y-8">
        <div>
          <Link href="/" className="flex justify-center">
            <span className="text-3xl font-bold text-indigo-600">{t.brand}</span>
          </Link>
          <h2 className="mt-6 text-center text-2xl font-bold text-gray-900">
            {t.welcome}
          </h2>

          {/* Progress */}
          <div className="mt-6 flex justify-center space-x-2">
            {[1, 2].map((s) => (
              <div
                key={s}
                className={`h-2 w-16 rounded-full ${
                  s <= step ? 'bg-indigo-600' : 'bg-gray-200'
                }`}
              />
            ))}
          </div>
        </div>

        {step === 1 && (
          <div className="space-y-6">
            <p className="text-center text-gray-600">{t.industryQuestion}</p>

            <div className="grid grid-cols-2 gap-3">
              {USE_CASE_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSelectedUseCase(id)}
                  className={`flex items-center p-4 rounded-lg border-2 transition-colors ${
                    selectedUseCase === id
                      ? 'border-indigo-600 bg-indigo-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <span className="text-2xl mr-3">{USE_CASE_ICONS[id]}</span>
                  <span className="text-sm font-medium text-gray-900">{t.useCases[id]}</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!selectedUseCase}
              className="w-full py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t.continue}
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <p className="text-center text-gray-600">
              {t.goalsQuestion}
            </p>

            <div className="space-y-3">
              {GOAL_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleGoal(id)}
                  className={`flex items-center w-full p-4 rounded-lg border-2 transition-colors ${
                    selectedGoals.includes(id)
                      ? 'border-indigo-600 bg-indigo-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded border-2 mr-3 flex items-center justify-center ${
                      selectedGoals.includes(id)
                        ? 'bg-indigo-600 border-indigo-600'
                        : 'border-gray-300'
                    }`}
                  >
                    {selectedGoals.includes(id) && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <span className="text-sm font-medium text-gray-900">{t.goals[id]}</span>
                </button>
              ))}
            </div>

            <div className="flex space-x-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex-1 py-3 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                {t.back}
              </button>
              <button
                type="button"
                onClick={handleComplete}
                disabled={selectedGoals.length === 0 || isLoading}
                className="flex-1 py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? t.starting : t.getStarted}
              </button>
            </div>
          </div>
        )}

        <p className="text-center text-sm text-gray-500">
          <Link href="/dashboard" className="text-indigo-600 hover:text-indigo-500">
            {t.skipForNow}
          </Link>
        </p>
      </div>
    </div>
  );
}
