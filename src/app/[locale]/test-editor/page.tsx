'use client';

import { useState } from 'react';
import { MonacoPolicyEditor } from '@/components/policy/monaco-policy-editor';

const TEST_CODE = `This module is test.hello.

To sayHello with name, produce:
  Return "Hello, " plus name.

To invalidFunction, produce:
  Return undefinedVariable.
`;

export default function TestEditorPage() {
  const [code, setCode] = useState(TEST_CODE);

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Editor Test Page</h1>
      <p className="mb-4 text-gray-600">
        This page tests the Monaco editor with local compiler validation.
        The code below contains an error (undefinedVariable) that should show a red squiggly underline.
      </p>
      <MonacoPolicyEditor
        value={code}
        onChange={setCode}
        height="400px"
        locale="en"
        enableLSP={false}
      />
    </div>
  );
}
