import { LoadingSkeleton } from '@/components/feedback/loading-skeleton';
import { Container, Stack } from '@/components/ui';

export default function ReportsLoading() {
  return (
    <Container size="xl" className="py-8">
      <Stack gap={6}>
        <LoadingSkeleton lines={2} className="max-w-md" />
        <LoadingSkeleton lines={6} />
      </Stack>
    </Container>
  );
}
