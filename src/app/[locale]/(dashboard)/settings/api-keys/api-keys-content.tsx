'use client';

import { useState } from 'react';
import { Copy, CheckCircle2, X as XIcon } from 'lucide-react';
import { formatDate } from '@/lib/format';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Breadcrumbs,
  Button,
  Card,
  CardBody,
  Container,
  Input,
  Stack,
  cn,
} from '@/components/ui';

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
}

interface Translations {
  breadcrumb: string;
  title: string;
  subtitle: string;
  keyCreated: string;
  copyWarning: string;
  copy: string;
  dismiss: string;
  createNew: string;
  keyPlaceholder: string;
  creating: string;
  createKey: string;
  enterName: string;
  confirmRevoke: string;
  yourKeys: string;
  noKeys: string;
  name: string;
  key: string;
  lastUsed: string;
  created: string;
  actions: string;
  never: string;
  revoke: string;
  usageExample: string;
  usageDescription: string;
  examples: {
    getPolicyId: string;
    getPolicyIdDesc: string;
    executePolicy: string;
    executePolicyDesc: string;
    listPolicies: string;
    listPoliciesDesc: string;
    responseExample: string;
    responseExampleDesc: string;
    errorHandling: string;
    errorHandlingDesc: string;
    error401: string;
    error403: string;
    error404: string;
    error429: string;
  };
  nav: {
    settings: string;
  };
}

interface ApiKeysContentProps {
  initialApiKeys: ApiKey[];
  translations: Translations;
  locale: string;
}

export function ApiKeysContent({
  initialApiKeys,
  translations: t,
  locale,
}: ApiKeysContentProps) {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>(initialApiKeys);
  const [isCreating, setIsCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  const [error, setError] = useState('');

  const fetchApiKeys = async () => {
    try {
      const response = await fetch('/api/api-keys');
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || 'Failed to fetch API keys');
      }

      const data = await response.json();
      const normalized = Array.isArray(data)
        ? data
        : (data as { keys?: ApiKey[] }).keys || [];
      setApiKeys(normalized);
    } catch (err) {
      console.error('Failed to fetch API keys:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch API keys');
    }
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) {
      setError(t.enterName);
      return;
    }

    setIsCreating(true);
    setError('');

    try {
      const response = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || 'Failed to create API key');
      }

      const data = await response.json();
      setNewKeyValue(data.key);
      setNewKeyName('');
      fetchApiKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create API key');
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    if (!confirm(t.confirmRevoke)) {
      return;
    }

    try {
      const response = await fetch(`/api/api-keys/${keyId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || 'Failed to revoke API key');
      }

      fetchApiKeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke API key');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <Container size="wide" className="py-6 sm:py-10">
      <Stack gap={6}>
        <Stack gap={2}>
          <Breadcrumbs
            items={[
              { label: t.nav.settings, href: '/settings' },
              { label: t.breadcrumb },
            ]}
          />
          <h1 className="font-display text-3xl font-semibold tracking-tight text-fg">
            {t.title}
          </h1>
          <p className="text-sm text-fg-muted">{t.subtitle}</p>
        </Stack>

        {/* "Key created" — show the secret once, never again */}
        {newKeyValue && (
          <Alert variant="success" hideIcon>
            <Stack direction="row" gap={3} align="start">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
              <Stack gap={3} className="min-w-0 flex-1">
                <Stack gap={1}>
                  <AlertTitle>{t.keyCreated}</AlertTitle>
                  <AlertDescription>{t.copyWarning}</AlertDescription>
                </Stack>
                <Stack direction="row" gap={2} align="center">
                  <code className="flex-1 break-all rounded bg-success-subtle px-3 py-2 font-mono text-sm text-emerald-900">
                    {newKeyValue}
                  </code>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => copyToClipboard(newKeyValue)}
                  >
                    <Copy className="size-3.5" aria-hidden />
                    {t.copy}
                  </Button>
                </Stack>
                <button
                  type="button"
                  onClick={() => setNewKeyValue(null)}
                  className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"
                >
                  <XIcon className="size-3.5" aria-hidden />
                  {t.dismiss}
                </button>
              </Stack>
            </Stack>
          </Alert>
        )}

        {error && (
          <Alert variant="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Create new key */}
        <Card>
          <CardBody className="pt-6">
            <Stack gap={4}>
              <label
                htmlFor="apiKeyName"
                className="font-display text-xl font-semibold tracking-tight text-fg"
              >
                {t.createNew}
              </label>
              <form onSubmit={handleCreateKey} className="flex gap-3">
                <Input
                  type="text"
                  id="apiKeyName"
                  name="apiKeyName"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder={t.keyPlaceholder}
                  className="flex-1"
                />
                <Button type="submit" disabled={isCreating}>
                  {isCreating ? t.creating : t.createKey}
                </Button>
              </form>
            </Stack>
          </CardBody>
        </Card>

        {/* Keys list */}
        <Card>
          <CardBody className="pt-6">
            <Stack gap={4}>
              <h2 className="font-display text-xl font-semibold tracking-tight text-fg">
                {t.yourKeys}
              </h2>
              {apiKeys.length === 0 ? (
                <p className="py-8 text-center text-fg-muted">{t.noKeys}</p>
              ) : (
                <div className="overflow-hidden">
                  <table className="min-w-full divide-y divide-border">
                    <thead>
                      <tr>
                        <Th>{t.name}</Th>
                        <Th>{t.key}</Th>
                        <Th>{t.lastUsed}</Th>
                        <Th>{t.created}</Th>
                        <Th align="right">{t.actions}</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {apiKeys.map((key) => (
                        <tr key={key.id}>
                          <td className="whitespace-nowrap px-3 py-4 text-sm font-medium text-fg">
                            {key.name}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 font-mono text-sm text-fg-muted">
                            {key.prefix}...
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-fg-muted">
                            {key.lastUsedAt ? formatDate(key.lastUsedAt, locale) : t.never}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-fg-muted">
                            {formatDate(key.createdAt, locale)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-right text-sm">
                            <button
                              type="button"
                              onClick={() => handleRevokeKey(key.id)}
                              className="text-danger hover:opacity-80"
                            >
                              {t.revoke}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Stack>
          </CardBody>
        </Card>

        {/* Usage examples — code snippets */}
        <Card>
          <CardBody className="pt-6">
            <Stack gap={6}>
              <Stack gap={1}>
                <h2 className="font-display text-xl font-semibold tracking-tight text-fg">
                  {t.usageExample}
                </h2>
                <p className="text-sm text-fg-muted">{t.usageDescription}</p>
              </Stack>

              <Alert variant="info">
                <AlertTitle>{t.examples.getPolicyId}</AlertTitle>
                <AlertDescription>{t.examples.getPolicyIdDesc}</AlertDescription>
              </Alert>

              {/* Execute policy — three snippets */}
              <Stack gap={4}>
                <Stack gap={1}>
                  <h3 className="text-sm font-semibold text-fg">{t.examples.executePolicy}</h3>
                  <p className="text-xs text-fg-muted">{t.examples.executePolicyDesc}</p>
                </Stack>
                <CodeBlock
                  label="cURL"
                  copyLabel={t.copy}
                  copy={copyToClipboard}
                  code={`curl -X POST https://policy.aster-lang.dev/api/v1/policies/evaluate \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "policyModule": "aster.finance.loan",
    "policyFunction": "evaluateLoanEligibility",
    "context": [{
      "creditScore": 750,
      "income": 85000,
      "loanAmount": 250000
    }]
  }'`}
                />
                <CodeBlock
                  label="JavaScript / Node.js"
                  copyLabel={t.copy}
                  copy={copyToClipboard}
                  code={`const response = await fetch('https://policy.aster-lang.dev/api/v1/policies/evaluate', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    policyModule: 'aster.finance.loan',
    policyFunction: 'evaluateLoanEligibility',
    context: [{
      creditScore: 750,
      income: 85000,
      loanAmount: 250000,
    }],
  }),
});

const { result, executionTimeMs, error } = await response.json();
if (error) console.error(error);
else console.log('Decision:', result, 'in', executionTimeMs, 'ms');`}
                />
                <CodeBlock
                  label="Python"
                  copyLabel={t.copy}
                  copy={copyToClipboard}
                  code={`import requests

response = requests.post(
    'https://policy.aster-lang.dev/api/v1/policies/evaluate',
    headers={
        'Authorization': 'Bearer YOUR_API_KEY',
        'Content-Type': 'application/json',
    },
    json={
        'policyModule': 'aster.finance.loan',
        'policyFunction': 'evaluateLoanEligibility',
        'context': [{
            'creditScore': 750,
            'income': 85000,
            'loanAmount': 250000,
        }],
    },
)

data = response.json()
if data.get('error'):
    print('Error:', data['error'])
else:
    print('Decision:', data['result'], 'in', data['executionTimeMs'], 'ms')`}
                />
              </Stack>

              {/* List policy versions */}
              <Stack gap={3}>
                <Stack gap={1}>
                  <h3 className="text-sm font-semibold text-fg">{t.examples.listPolicies}</h3>
                  <p className="text-xs text-fg-muted">{t.examples.listPoliciesDesc}</p>
                </Stack>
                <CodeBlock
                  label="cURL"
                  copyLabel={t.copy}
                  copy={copyToClipboard}
                  code={`curl -X GET https://policy.aster-lang.dev/api/v1/policies/YOUR_POLICY_ID/versions \\
  -H "Authorization: Bearer YOUR_API_KEY"`}
                />
              </Stack>

              {/* Response shape */}
              <Stack gap={3}>
                <Stack gap={1}>
                  <h3 className="text-sm font-semibold text-fg">{t.examples.responseExample}</h3>
                  <p className="text-xs text-fg-muted">{t.examples.responseExampleDesc}</p>
                </Stack>
                <CodeBlock
                  code={`{
  "result": {
    "approved": true,
    "interestRate": 0.0625,
    "reasons": ["credit_score_check", "income_verification"]
  },
  "executionTimeMs": 12,
  "error": null
}`}
                />
              </Stack>

              {/* Error catalog */}
              <Stack gap={3}>
                <Stack gap={1}>
                  <h3 className="text-sm font-semibold text-fg">{t.examples.errorHandling}</h3>
                  <p className="text-xs text-fg-muted">{t.examples.errorHandlingDesc}</p>
                </Stack>
                <Alert variant="warning" hideIcon className="text-xs">
                  <Stack gap={1}>
                    <ErrorRow code="401" text={t.examples.error401} />
                    <ErrorRow code="403" text={t.examples.error403} />
                    <ErrorRow code="404" text={t.examples.error404} />
                    <ErrorRow code="429" text={t.examples.error429} />
                  </Stack>
                </Alert>
              </Stack>
            </Stack>
          </CardBody>
        </Card>
      </Stack>
    </Container>
  );
}

/* ------------------------------------------------------------------ */
/* Subcomponents                                                       */
/* ------------------------------------------------------------------ */

function Th({
  children, align = 'left',
}: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      scope="col"
      className={cn(
        'px-3 py-3 text-xs font-medium uppercase tracking-wider text-fg-muted',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  );
}

interface CodeBlockProps {
  code: string;
  label?: string;
  copyLabel?: string;
  copy?: (text: string) => void;
}

function CodeBlock({ code, label, copyLabel, copy }: CodeBlockProps) {
  return (
    <Stack gap={1}>
      {(label || (copy && copyLabel)) && (
        <Stack direction="row" justify="between" align="center">
          {label && (
            <span className="text-xs font-medium uppercase text-fg-muted">{label}</span>
          )}
          {copy && copyLabel && (
            <button
              type="button"
              onClick={() => copy(code)}
              className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary-hover"
            >
              <Copy className="size-3" aria-hidden />
              {copyLabel}
            </button>
          )}
        </Stack>
      )}
      <pre className="overflow-x-auto rounded-md bg-zinc-900 p-3 font-mono text-xs text-zinc-100">
        {code}
      </pre>
    </Stack>
  );
}

function ErrorRow({ code, text }: { code: string; text: string }) {
  return (
    <p>
      <code className="rounded bg-warning-subtle px-1 font-mono">{code}</code> — {text}
    </p>
  );
}
