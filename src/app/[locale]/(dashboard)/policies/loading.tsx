import { LoadingSkeleton } from '@/components/feedback/loading-skeleton';
import { Container, Stack } from '@/components/ui';

export default function PoliciesLoading() {
  return (
    <Container size="xl" className="py-8">
      <Stack gap={6}>
        <LoadingSkeleton lines={2} className="max-w-md" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[16rem_1fr]">
          <LoadingSkeleton lines={6} />
          <LoadingSkeleton lines={10} />
        </div>
      </Stack>
    </Container>
  );
}
