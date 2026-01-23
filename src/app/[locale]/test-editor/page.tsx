'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';

// Dynamically import Monaco editor to prevent SSR issues
const MonacoPolicyEditor = dynamic(
  () => import('@/components/policy/monaco-policy-editor').then((mod) => mod.MonacoPolicyEditor),
  { ssr: false, loading: () => <div className="h-[400px] bg-gray-100 dark:bg-gray-800 animate-pulse rounded-lg" /> }
);

const TEST_CODE_EN = `This module is test.hello.

To sayHello with name, produce:
  Return "Hello, " plus name.

To invalidFunction, produce:
  Return undefinedVariable.
`;

const TEST_CODE_DE = `Dieses Modul ist kredit.

Definiere Kreditantrag mit bonitaet Int, betrag Float, laufzeit Int.

bewerteAntrag mit antrag Kreditantrag, liefert Bool:
  wenn antrag.bonitaet groesser als 700:
    gib zurueck wahr.
  sonst:
    gib zurueck falsch.
`;

const TEST_CODE_ZH = `【模块】信用评估。

【定义】贷款申请，包含 信用评分 整数，贷款金额 浮点数，贷款期限 整数。

评估申请 以 申请 贷款申请，返回 布尔:
  若 申请.信用评分 大于 700:
    返回 真。
  否则:
    返回 假。
`;

function getTestCode(locale: string): string {
  switch (locale) {
    case 'de':
      return TEST_CODE_DE;
    case 'zh':
      return TEST_CODE_ZH;
    default:
      return TEST_CODE_EN;
  }
}

export default function TestEditorPage() {
  const params = useParams();
  const locale = (params?.locale as string) || 'en';
  const [code, setCode] = useState(() => getTestCode(locale));

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Editor Test Page</h1>
      <p className="mb-4 text-gray-600">
        This page tests the Monaco editor with local compiler validation.
        The code shows a sample policy in {locale === 'de' ? 'German' : locale === 'zh' ? 'Chinese' : 'English'} CNL syntax.
      </p>
      <MonacoPolicyEditor
        value={code}
        onChange={setCode}
        height="400px"
        locale={locale}
      />
    </div>
  );
}
