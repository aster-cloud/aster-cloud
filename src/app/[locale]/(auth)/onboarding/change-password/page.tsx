import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/auth';
import { db, users } from '@/lib/prisma';
import { ChangePasswordContent } from './change-password-content';

interface Props {
  params: Promise<{ locale: string }>;
}

/**
 * Force-rotate password page.
 *
 * Reached from the dashboard layout when the user has
 * mustChangePassword=true. If they navigate here without the flag
 * (e.g. bookmark), bounce them back to the dashboard so it doesn't
 * surface as a "voluntary" change-password endpoint — the
 * /forgot-password + /reset-password flow is the right path for
 * intentional rotation.
 */
export default async function ChangePasswordPage({ params }: Props) {
  const { locale } = await params;
  const session = await getSession();
  if (!session?.user?.id) {
    redirect(`/${locale}/login`);
  }
  const row = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { mustChangePassword: true, email: true },
  });
  if (!row?.mustChangePassword) {
    redirect(`/${locale}/dashboard`);
  }
  return <ChangePasswordContent email={row.email ?? ''} />;
}
