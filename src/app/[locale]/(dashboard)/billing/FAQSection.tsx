'use client';

import { useState } from 'react';

// FAQ item keys organized by category
const PRODUCT_FAQ_KEYS = [
  'whatIsAster',
  'whatIsPolicy',
  'piiDetection',
  'complianceStandards',
  'integration',
  'selfHosted',
] as const;

const BILLING_FAQ_KEYS = [
  'apiVsExecutions',
  'freeLimits',
  'upgradePlan',
  'downgrade',
  'trialEnds',
  'cancelAnytime',
  'refunds',
  'invoices',
  'dataSecurity',
  'support',
] as const;

type FAQKey = typeof PRODUCT_FAQ_KEYS[number] | typeof BILLING_FAQ_KEYS[number];

interface FAQItemProps {
  faqKey: FAQKey;
  t: (key: string) => string;
  isOpen: boolean;
  onToggle: () => void;
}

function FAQItem({ faqKey, t, isOpen, onToggle }: FAQItemProps) {
  return (
    <div className="border-b border-gray-200">
      <button
        type="button"
        onClick={onToggle}
        className="w-full py-4 flex items-center justify-between text-left"
      >
        <span className="text-base font-medium text-gray-900">
          {t(`faq.${faqKey}.question`)}
        </span>
        <svg
          className={`h-5 w-5 text-gray-500 transform transition-transform ${isOpen ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {isOpen && (
        <div className="pb-4 text-sm text-gray-600">
          {t(`faq.${faqKey}.answer`)}
        </div>
      )}
    </div>
  );
}

interface FAQCategoryProps {
  title: string;
  faqKeys: readonly FAQKey[];
  t: (key: string) => string;
  openItems: Set<FAQKey>;
  onToggle: (key: FAQKey) => void;
}

function FAQCategory({ title, faqKeys, t, openItems, onToggle }: FAQCategoryProps) {
  return (
    <div>
      <h4 className="text-lg font-semibold text-gray-900 mb-4">{title}</h4>
      <div className="space-y-0">
        {faqKeys.map((key) => (
          <FAQItem
            key={key}
            faqKey={key}
            t={t}
            isOpen={openItems.has(key)}
            onToggle={() => onToggle(key)}
          />
        ))}
      </div>
    </div>
  );
}

interface FAQSectionProps {
  t: (key: string) => string;
}

export default function FAQSection({ t }: FAQSectionProps) {
  const [openItems, setOpenItems] = useState<Set<FAQKey>>(new Set());

  const handleToggle = (key: FAQKey) => {
    setOpenItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <div className="mt-16">
      <h3 className="text-xl font-semibold text-gray-900 mb-8">{t('faq.title')}</h3>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <FAQCategory
          title={t('faq.productQuestions')}
          faqKeys={PRODUCT_FAQ_KEYS}
          t={t}
          openItems={openItems}
          onToggle={handleToggle}
        />
        <FAQCategory
          title={t('faq.billingQuestions')}
          faqKeys={BILLING_FAQ_KEYS}
          t={t}
          openItems={openItems}
          onToggle={handleToggle}
        />
      </div>
    </div>
  );
}
