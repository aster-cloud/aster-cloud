/**
 * Internal design-system preview page.
 *
 * Reachable at /<locale>/design-preview. Robots meta set to noindex so
 * it doesn't surface in search results. The dashboard nav doesn't link
 * here — only reviewers with the URL find it.
 *
 * Used by W2 reviewers to validate every UI primitive renders correctly
 * after the Tailwind 4 @theme + @aster-cloud/tokens chain.
 *
 * Delete (or move to apps/storybook in aster-design-system) before
 * public launch.
 */
import type { Metadata } from 'next';
import {
  Button,
  Card, CardHeader, CardTitle, CardDescription, CardBody, CardFooter,
  Wordmark,
  Input, Textarea, Label, Select,
  Badge, Alert, AlertTitle, AlertDescription, Skeleton,
  Separator, Stack, Container,
} from '@/components/ui';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: 'Design system preview',
};

export default function DesignPreviewPage() {
  return (
    <Container size="xl" className="py-16">
      <Stack gap={12}>
        {/* Header */}
        <Stack gap={3}>
          <p className="font-sans text-xs font-semibold uppercase tracking-widest text-primary">
            aster-cloud · UI primitives
          </p>
          <h1 className="font-display text-5xl font-semibold leading-snug tracking-tight text-fg">
            Design system preview
          </h1>
          <p className="max-w-prose text-fg-muted">
            Every primitive used in the W2 sweep, rendered once. If anything
            here looks wrong, the token chain or the @aster-cloud/ui package
            is the place to fix — not the consuming page.
          </p>
        </Stack>

        {/* Wordmark */}
        <Section title="Wordmark">
          <Stack direction="row" gap={8} wrap align="end">
            <Wordmark size="lg" />
            <Wordmark variant="product" size="lg" />
            <Wordmark variant="dev" size="lg" />
          </Stack>
        </Section>

        {/* Buttons */}
        <Section title="Buttons">
          <Stack gap={4}>
            <Stack direction="row" gap={3} wrap>
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="accent">Accent</Button>
              <Button variant="destructive">Destructive</Button>
              <Button disabled>Disabled</Button>
            </Stack>
            <Stack direction="row" gap={3} align="center">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
            </Stack>
          </Stack>
        </Section>

        {/* Cards */}
        <Section title="Cards">
          <Stack direction="row" gap={6} wrap>
            <Card className="max-w-sm flex-1">
              <CardHeader>
                <CardTitle>Loan eligibility</CardTitle>
                <CardDescription>v3.2 · deployed 2h ago</CardDescription>
              </CardHeader>
              <CardBody>
                <p className="text-sm text-fg-muted">
                  Approved 78% of applicants in the last 24h. Decision trace
                  available on every call.
                </p>
              </CardBody>
              <CardFooter>
                <Button size="sm">Open</Button>
                <Button size="sm" variant="ghost">Trace</Button>
              </CardFooter>
            </Card>
            <Card className="max-w-sm flex-1 bg-primary-subtle">
              <CardHeader>
                <CardTitle>AI assistant</CardTitle>
                <CardDescription>Describe a policy, get CNL drafted.</CardDescription>
              </CardHeader>
              <CardFooter>
                <Button size="sm" variant="accent">Try it</Button>
              </CardFooter>
            </Card>
          </Stack>
        </Section>

        {/* Form atoms */}
        <Section title="Form atoms">
          <Card>
            <CardBody>
              <Stack gap={5}>
                <Stack gap={2}>
                  <Label htmlFor="dp-email">Work email</Label>
                  <Input id="dp-email" type="email" placeholder="you@company.com" />
                </Stack>
                <Stack gap={2}>
                  <Label htmlFor="dp-bad">Invalid example</Label>
                  <Input id="dp-bad" state="invalid" defaultValue="not-an-email" />
                </Stack>
                <Stack gap={2}>
                  <Label htmlFor="dp-plan">Plan</Label>
                  <Select id="dp-plan" defaultValue="pro">
                    <option value="free">Free</option>
                    <option value="pro">Pro</option>
                    <option value="enterprise">Enterprise</option>
                  </Select>
                </Stack>
                <Stack gap={2}>
                  <Label htmlFor="dp-notes">Notes</Label>
                  <Textarea id="dp-notes" rows={4} placeholder="What does this policy do?" />
                </Stack>
              </Stack>
            </CardBody>
          </Card>
        </Section>

        {/* Status atoms */}
        <Section title="Status: badges">
          <Stack direction="row" gap={3} wrap>
            <Badge>Neutral</Badge>
            <Badge variant="primary">Primary</Badge>
            <Badge variant="accent">Accent</Badge>
            <Badge variant="success">Success</Badge>
            <Badge variant="warning">Warning</Badge>
            <Badge variant="danger">Danger</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="primary-solid">Default</Badge>
            <Badge variant="success-solid">Approved</Badge>
          </Stack>
        </Section>

        <Section title="Status: alerts">
          <Stack gap={3}>
            <Alert variant="info">
              <AlertTitle>Heads up</AlertTitle>
              <AlertDescription>
                Your policy is in draft. Save a version before others can review.
              </AlertDescription>
            </Alert>
            <Alert variant="success">
              <AlertTitle>Saved.</AlertTitle>
              <AlertDescription>v3.3 is now the default version.</AlertDescription>
            </Alert>
            <Alert variant="warning">
              <AlertTitle>Trial ends in 3 days</AlertTitle>
              <AlertDescription>
                Add a billing method to keep your usage limits.
              </AlertDescription>
            </Alert>
            <Alert variant="danger">
              <AlertTitle>Could not save</AlertTitle>
              <AlertDescription>Validation failed at line 12.</AlertDescription>
            </Alert>
          </Stack>
        </Section>

        <Section title="Status: skeleton">
          <Card>
            <CardBody>
              <Stack gap={3}>
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Stack direction="row" gap={3} align="center">
                  <Skeleton className="size-12 rounded-full" />
                  <Stack gap={2} className="flex-1">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </Stack>
                </Stack>
              </Stack>
            </CardBody>
          </Card>
        </Section>

        {/* Layout */}
        <Section title="Layout helpers">
          <Stack gap={4}>
            <p className="text-sm text-fg-muted">Stack direction=row, gap=4:</p>
            <Stack direction="row" gap={4}>
              <Card className="flex-1"><CardBody>One</CardBody></Card>
              <Card className="flex-1"><CardBody>Two</CardBody></Card>
              <Card className="flex-1"><CardBody>Three</CardBody></Card>
            </Stack>
            <Separator />
            <p className="text-sm text-fg-muted">Vertical separator between inline elements:</p>
            <Stack direction="row" gap={3} align="center" className="h-6">
              <span className="text-sm text-fg">Alice</span>
              <Separator orientation="vertical" />
              <span className="text-sm text-fg">Bob</span>
              <Separator orientation="vertical" />
              <span className="text-sm text-fg">Carol</span>
            </Stack>
          </Stack>
        </Section>
      </Stack>
    </Container>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Stack gap={4}>
      <h2 className="font-display text-2xl font-semibold tracking-tight text-fg">
        {title}
      </h2>
      {children}
    </Stack>
  );
}
