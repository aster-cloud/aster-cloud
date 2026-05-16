/**
 * Client islands for the Settings page.
 *
 * The page itself is a Server Component (settings/page.tsx) so the
 * profile card no longer flashes "Not set" while waiting for
 * useSession() on the client. Everything that genuinely needs the
 * browser — cookie I/O, signOut(), router.refresh() — lives in this
 * file as small isolated islands:
 *
 *   - LocaleDetectionToggle: writes a cookie and refreshes the RSC
 *     tree so middleware picks the new value up on the next request.
 *   - SignOutButton: calls next-auth's signOut() with a locale-aware
 *     callback URL.
 *   - DeleteAccountButton + DeleteAccountDialog: confirmation flow
 *     for the destructive account-delete action.
 *
 * Splitting them this way keeps the dashboard layout's session lookup
 * on the server (where it belongs) and stops re-running the whole
 * page's render tree on the client for cosmetic interactions.
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { ConfirmDialog } from '@/components/ui';
import { Alert, AlertDescription, Button, cn } from '@/components/ui';

const LOCALE_DETECTION_COOKIE = 'aster-locale-detection';

function setCookie(name: string, value: string, days = 365) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${value}; expires=${expires}; path=/; SameSite=Lax`;
}

/* ------------------------------------------------------------------ */
/* LocaleDetectionToggle                                               */
/* ------------------------------------------------------------------ */

export function LocaleDetectionToggle({
  initialChecked,
  ariaLabel,
  enabledHint,
  disabledHint,
}: {
  initialChecked: boolean;
  ariaLabel: string;
  enabledHint: string;
  disabledHint: string;
}) {
  // Local state is seeded from the cookie value read on the server,
  // so the toggle never flickers from "off" to "on" after mount.
  const [checked, setChecked] = useState(initialChecked);
  const router = useRouter();

  const handleToggle = () => {
    const next = !checked;
    setChecked(next);
    setCookie(LOCALE_DETECTION_COOKIE, String(next));
    // RSC re-render so middleware reads the updated cookie on the next
    // request. Keeps client state + scroll position intact.
    router.refresh();
  };

  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        onClick={handleToggle}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
          'transition-colors duration-fast ease-standard',
          'focus-visible:outline-none focus-visible:shadow-ring',
          checked ? 'bg-primary' : 'bg-bg-muted',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'pointer-events-none inline-block size-5 transform rounded-full bg-bg shadow ring-0',
            'transition-transform duration-fast ease-standard',
            checked ? 'translate-x-5' : 'translate-x-0',
          )}
        />
      </button>
      {/* Hint paragraph is sibling so the toggle row stays tight. The
          parent server card supplies the row layout. */}
      <p className="text-xs text-fg-subtle" data-locale-detection-hint>
        {checked ? enabledHint : disabledHint}
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* SignOutButton                                                       */
/* ------------------------------------------------------------------ */

export function SignOutButton({
  signOutLabel,
  signingOutLabel,
  callbackUrl,
}: {
  signOutLabel: string;
  signingOutLabel: string;
  callbackUrl: string;
}) {
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={async () => {
        setIsLoggingOut(true);
        await signOut({ callbackUrl });
      }}
      disabled={isLoggingOut}
    >
      {isLoggingOut ? signingOutLabel : signOutLabel}
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/* DeleteAccountFlow                                                   */
/* ------------------------------------------------------------------ */

export function DeleteAccountFlow({
  triggerLabel,
  callbackUrl,
  labels,
}: {
  triggerLabel: string;
  callbackUrl: string;
  labels: {
    confirmTitle: string;
    confirmMessage: string;
    confirmItem1: string;
    confirmItem2: string;
    confirmItem3: string;
    confirmDelete: string;
    cancel: string;
    deleting: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch('/api/user/delete', { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete account');
      }
      await signOut({ callbackUrl });
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : 'Failed to delete account',
      );
      setIsDeleting(false);
    }
  };

  return (
    <>
      <Button type="button" variant="destructive" onClick={() => setOpen(true)}>
        {triggerLabel}
      </Button>
      <ConfirmDialog
        isOpen={open}
        onCancel={() => !isDeleting && setOpen(false)}
        onConfirm={handleDelete}
        title={labels.confirmTitle}
        description={
          <div className="space-y-3">
            <p>{labels.confirmMessage}</p>
            <ul className="list-inside list-disc space-y-1 text-sm text-fg-muted">
              <li>{labels.confirmItem1}</li>
              <li>{labels.confirmItem2}</li>
              <li>{labels.confirmItem3}</li>
            </ul>
            {deleteError && (
              <Alert variant="danger">
                <AlertDescription>{deleteError}</AlertDescription>
              </Alert>
            )}
          </div>
        }
        confirmLabel={isDeleting ? labels.deleting : labels.confirmDelete}
        cancelLabel={labels.cancel}
        variant="danger"
        isLoading={isDeleting}
      />
    </>
  );
}
