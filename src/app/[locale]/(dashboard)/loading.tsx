import { LoadingSkeleton } from '@/components/feedback/loading-skeleton';
import { Container, Stack } from '@/components/ui';

// Route-segment loading.tsx — Next.js shows this instantly while the
// matching page.tsx is awaiting server data. Without it, every cross-page
// dashboard nav blocks on a blank screen until the RSC payload arrives.
// Skeleton rows mirror the dominant dashboard pattern (heading + list).
export default function DashboardLoading() {
  return (
    <Container size="xl" className="py-8">
      <Stack gap={6}>
        <LoadingSkeleton lines={2} className="max-w-md" />
        <LoadingSkeleton lines={8} />
      </Stack>
    </Container>
  );
}
