import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { isAdminFromSession } from '@/lib/admin-auth';
import { CircuitBreakerContent } from './circuit-breaker-content';

/**
 * /admin/ai-circuit-breaker — admin-only manual override for the
 * platform-wide LLM cost kill switch.
 */
export default async function CircuitBreakerPage() {
  const session = await getSession();
  if (!session?.user?.id) {
    redirect('/login');
  }
  const isAdmin = await isAdminFromSession();
  if (!isAdmin) {
    redirect('/dashboard');
  }
  return <CircuitBreakerContent />;
}
