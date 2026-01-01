'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const USE_CASES = [
  { id: 'finance', label: 'Financial Services', icon: '🏦' },
  { id: 'healthcare', label: 'Healthcare', icon: '🏥' },
  { id: 'ecommerce', label: 'E-commerce', icon: '🛒' },
  { id: 'insurance', label: 'Insurance', icon: '📋' },
  { id: 'legal', label: 'Legal', icon: '⚖️' },
  { id: 'other', label: 'Other', icon: '🔧' },
];

const GOALS = [
  { id: 'pii', label: 'PII detection & protection' },
  { id: 'compliance', label: 'Compliance reporting' },
  { id: 'automation', label: 'Business rule automation' },
  { id: 'team', label: 'Team policy collaboration' },
  { id: 'integration', label: 'API integration' },
];

export default function OnboardingPage() {
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
            <span className="text-3xl font-bold text-indigo-600">Aster Cloud</span>
          </Link>
          <h2 className="mt-6 text-center text-2xl font-bold text-gray-900">
            Welcome! Let&apos;s get you started
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
            <p className="text-center text-gray-600">What industry are you in?</p>

            <div className="grid grid-cols-2 gap-3">
              {USE_CASES.map((useCase) => (
                <button
                  key={useCase.id}
                  type="button"
                  onClick={() => setSelectedUseCase(useCase.id)}
                  className={`flex items-center p-4 rounded-lg border-2 transition-colors ${
                    selectedUseCase === useCase.id
                      ? 'border-indigo-600 bg-indigo-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <span className="text-2xl mr-3">{useCase.icon}</span>
                  <span className="text-sm font-medium text-gray-900">{useCase.label}</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!selectedUseCase}
              className="w-full py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <p className="text-center text-gray-600">
              What are your main goals with Aster Cloud?
            </p>

            <div className="space-y-3">
              {GOALS.map((goal) => (
                <button
                  key={goal.id}
                  type="button"
                  onClick={() => toggleGoal(goal.id)}
                  className={`flex items-center w-full p-4 rounded-lg border-2 transition-colors ${
                    selectedGoals.includes(goal.id)
                      ? 'border-indigo-600 bg-indigo-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded border-2 mr-3 flex items-center justify-center ${
                      selectedGoals.includes(goal.id)
                        ? 'bg-indigo-600 border-indigo-600'
                        : 'border-gray-300'
                    }`}
                  >
                    {selectedGoals.includes(goal.id) && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <span className="text-sm font-medium text-gray-900">{goal.label}</span>
                </button>
              ))}
            </div>

            <div className="flex space-x-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex-1 py-3 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleComplete}
                disabled={selectedGoals.length === 0 || isLoading}
                className="flex-1 py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? 'Starting...' : 'Get Started'}
              </button>
            </div>
          </div>
        )}

        <p className="text-center text-sm text-gray-500">
          <Link href="/dashboard" className="text-indigo-600 hover:text-indigo-500">
            Skip for now
          </Link>
        </p>
      </div>
    </div>
  );
}
